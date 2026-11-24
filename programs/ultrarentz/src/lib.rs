//! UltraRentz — rent deposits on Solana.
//!
//! Flow
//! 1. Tenant locks the deposit in a program-owned vault (`create_tenancy`).
//! 2. Deposit earns yield while locked (devnet: simulated by topping up the vault;
//!    mainnet: lending-market adapter added in the Eternal sprint).
//! 3. Tenancy ends (fixed date, or `serve_notice` for rolling/periodic tenancies).
//! 4. Landlord either approves full release, or raises an evidenced claim inside the claim window.
//!    No claim in the window → anyone can call `settle` and the tenant is refunded automatically.
//! 5. A claim goes to DAO jurors. Tenant can accept it, or submit counter-evidence (optional).
//!    Below quorum by the deadline → tenant gets everything (burden of proof is on the landlord,
//!    and an absent tenant, e.g. an international student who has left the UK, is never defaulted against).
//! 6. `settle` pays landlord award, protocol fee (on yield only) and the rest to the tenant, then closes the vault.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked,
};

pub mod errors;
pub mod math;
pub mod state;
pub mod yield_adapter;

use errors::UrError;
use math::YieldSplit;
use state::*;
use yield_adapter::*;

declare_id!("13BK4Z9HZ2GWGzqHjPTDGW4Ayh9jN6iqPCkekCpfATzX");

#[program]
pub mod ultrarentz {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        dao_authority: Pubkey,
        yield_split: YieldSplit,
        claim_window_secs: i64,
        voting_period_secs: i64,
    ) -> Result<()> {
        require!(yield_split.is_valid(), UrError::InvalidSplit);
        require!(claim_window_secs > 0 && voting_period_secs > 0, UrError::InvalidParam);
        let c = &mut ctx.accounts.config;
        c.admin = ctx.accounts.admin.key();
        c.dao_authority = dao_authority;
        c.mint = ctx.accounts.mint.key();
        c.treasury = ctx.accounts.treasury.key();
        c.yield_split = yield_split;
        c.claim_window_secs = claim_window_secs;
        c.voting_period_secs = voting_period_secs;
        c.quorum = 1;
        c.juror_count = 0;
        c.jurors = [Pubkey::default(); MAX_JURORS];
        c.yield_program = Pubkey::default();
        c.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn update_params(
        ctx: Context<AdminOnly>,
        yield_split: YieldSplit,
        claim_window_secs: i64,
        voting_period_secs: i64,
    ) -> Result<()> {
        require!(yield_split.is_valid(), UrError::InvalidSplit);
        require!(claim_window_secs > 0 && voting_period_secs > 0, UrError::InvalidParam);
        let c = &mut ctx.accounts.config;
        c.yield_split = yield_split;
        c.claim_window_secs = claim_window_secs;
        c.voting_period_secs = voting_period_secs;
        Ok(())
    }

    /// DAO authority sets the juror panel and quorum.
    pub fn set_jurors(ctx: Context<DaoOnly>, jurors: Vec<Pubkey>, quorum: u8) -> Result<()> {
        require!(jurors.len() <= MAX_JURORS, UrError::TooManyJurors);
        require!(quorum >= 1 && (quorum as usize) <= jurors.len(), UrError::InvalidParam);
        let c = &mut ctx.accounts.config;
        c.jurors = [Pubkey::default(); MAX_JURORS];
        for (i, j) in jurors.iter().enumerate() {
            c.jurors[i] = *j;
        }
        c.juror_count = jurors.len() as u8;
        c.quorum = quorum;
        Ok(())
    }

    /// Tenant locks the deposit. `end_ts = 0` for a periodic/rolling tenancy.
    pub fn create_tenancy(
        ctx: Context<CreateTenancy>,
        tenancy_id: u64,
        principal: u64,
        end_ts: i64,
        agent: Option<Pubkey>,
    ) -> Result<()> {
        require!(principal > 0, UrError::ZeroDeposit);
        require_keys_neq!(ctx.accounts.tenant.key(), ctx.accounts.landlord.key(), UrError::SameParty);
        let now = Clock::get()?.unix_timestamp;
        require!(end_ts == 0 || end_ts > now, UrError::EndInPast);

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.tenant_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.tenant.to_account_info(),
                },
            ),
            principal,
            ctx.accounts.mint.decimals,
        )?;

        let t = &mut ctx.accounts.tenancy;
        t.tenant = ctx.accounts.tenant.key();
        t.landlord = ctx.accounts.landlord.key();
        t.agent = agent.unwrap_or_default();
        t.mint = ctx.accounts.mint.key();
        t.tenancy_id = tenancy_id;
        t.principal = principal;
        t.start_ts = now;
        t.end_ts = end_ts;
        t.status = TenancyStatus::Active;
        t.claim_amount = 0;
        t.landlord_evidence = [0; 32];
        t.tenant_evidence = [0; 32];
        t.voting_ends_ts = 0;
        t.vote_count = 0;
        t.voters = [Pubkey::default(); MAX_JURORS];
        t.votes = [0; MAX_JURORS];
        t.landlord_award = 0;
        t.yield_active = false;
        t.yield_shares_account = Pubkey::default();
        t.bump = ctx.bumps.tenancy;

        emit!(DepositLocked {
            tenancy: t.key(),
            tenant: t.tenant,
            landlord: t.landlord,
            agent: t.agent,
            principal,
            end_ts,
        });
        Ok(())
    }

    /// Either party sets the end date on a rolling tenancy (notice period agreed off-chain).
    pub fn serve_notice(ctx: Context<PartyAction>, end_ts: i64) -> Result<()> {
        let t = &mut ctx.accounts.tenancy;
        let signer = ctx.accounts.signer.key();
        require!(signer == t.tenant || signer == t.landlord, UrError::NotAParty);
        require!(t.status == TenancyStatus::Active, UrError::WrongStatus);
        require!(t.end_ts == 0, UrError::EndAlreadySet);
        require!(end_ts >= Clock::get()?.unix_timestamp, UrError::EndInPast);
        t.end_ts = end_ts;
        emit!(NoticeServed { tenancy: t.key(), by: signer, end_ts });
        Ok(())
    }

    /// Landlord one-click approves full return — the "instant release" path.
    pub fn approve_release(ctx: Context<LandlordAction>) -> Result<()> {
        let t = &mut ctx.accounts.tenancy;
        require!(t.status == TenancyStatus::Active, UrError::WrongStatus);
        require!(has_ended(t)?, UrError::NotEnded);
        t.landlord_award = 0;
        t.status = TenancyStatus::Resolved;
        emit!(ReleaseApproved { tenancy: t.key() });
        Ok(())
    }

    /// Landlord claims a deduction with an evidence hash, inside the claim window.
    pub fn raise_claim(
        ctx: Context<LandlordAction>,
        amount: u64,
        evidence_hash: [u8; 32],
        evidence_uri: String,
    ) -> Result<()> {
        let cfg = &ctx.accounts.config;
        let t = &mut ctx.accounts.tenancy;
        let now = Clock::get()?.unix_timestamp;
        require!(t.status == TenancyStatus::Active, UrError::WrongStatus);
        require!(has_ended(t)?, UrError::NotEnded);
        require!(now < t.end_ts + cfg.claim_window_secs, UrError::ClaimWindowClosed);
        require!(amount > 0 && amount <= t.principal, UrError::InvalidClaim);
        require!(evidence_hash != [0u8; 32], UrError::InvalidClaim);
        require!(evidence_uri.len() <= 200, UrError::InvalidParam);

        t.claim_amount = amount;
        t.landlord_evidence = evidence_hash;
        t.voting_ends_ts = now + cfg.voting_period_secs;
        t.status = TenancyStatus::Claimed;
        emit!(ClaimRaised {
            tenancy: t.key(),
            amount,
            evidence_hash,
            evidence_uri,
            voting_ends_ts: t.voting_ends_ts,
        });
        Ok(())
    }

    /// Tenant accepts the landlord's claim — settles without a vote.
    pub fn accept_claim(ctx: Context<TenantAction>) -> Result<()> {
        let t = &mut ctx.accounts.tenancy;
        require!(t.status == TenancyStatus::Claimed, UrError::WrongStatus);
        t.landlord_award = t.claim_amount;
        t.status = TenancyStatus::Resolved;
        emit!(ClaimAccepted { tenancy: t.key(), amount: t.claim_amount });
        Ok(())
    }

    /// Optional tenant counter-evidence. Not responding never counts against the tenant.
    pub fn submit_tenant_evidence(
        ctx: Context<TenantAction>,
        evidence_hash: [u8; 32],
        evidence_uri: String,
    ) -> Result<()> {
        let t = &mut ctx.accounts.tenancy;
        require!(t.status == TenancyStatus::Claimed, UrError::WrongStatus);
        require!(Clock::get()?.unix_timestamp < t.voting_ends_ts, UrError::VotingClosed);
        require!(evidence_uri.len() <= 200, UrError::InvalidParam);
        t.tenant_evidence = evidence_hash;
        emit!(TenantEvidence { tenancy: t.key(), evidence_hash, evidence_uri });
        Ok(())
    }

    /// A juror votes how much of the claim the landlord should receive (0..=claim).
    pub fn cast_vote(ctx: Context<CastVote>, award: u64) -> Result<()> {
        let cfg = &ctx.accounts.config;
        let t = &mut ctx.accounts.tenancy;
        let juror = ctx.accounts.juror.key();
        require!(t.status == TenancyStatus::Claimed, UrError::WrongStatus);
        require!(Clock::get()?.unix_timestamp < t.voting_ends_ts, UrError::VotingClosed);
        require!(cfg.is_juror(&juror), UrError::NotJuror);
        require!(juror != t.tenant && juror != t.landlord, UrError::ConflictOfInterest);
        let n = t.vote_count as usize;
        require!(!t.voters[..n].contains(&juror), UrError::AlreadyVoted);
        require!(n < MAX_JURORS, UrError::TooManyJurors);
        require!(award <= t.claim_amount, UrError::AwardTooHigh);
        t.voters[n] = juror;
        t.votes[n] = award;
        t.vote_count += 1;
        emit!(VoteCast { tenancy: t.key(), juror, award });
        Ok(())
    }

    /// Admin points the protocol at a lending program (Jupiter Lend Earn). Default = none.
    pub fn set_yield_program(ctx: Context<AdminOnly>, yield_program: Pubkey) -> Result<()> {
        ctx.accounts.config.yield_program = yield_program;
        Ok(())
    }

    /// Move the whole vault into the lending market (permissionless: tenant, agent or keeper).
    /// `remaining_accounts` = the lending program's deposit accounts, in its documented order.
    pub fn deposit_to_yield<'info>(
        ctx: Context<'_, '_, 'info, 'info, DepositToYield<'info>>,
    ) -> Result<()> {
        yield_adapter::deposit(ctx)
    }

    /// Pull everything (principal + interest) back from the lending market into the vault.
    /// Permissionless; the keeper sends this together with `settle`.
    pub fn withdraw_from_yield<'info>(
        ctx: Context<'_, '_, 'info, 'info, WithdrawFromYield<'info>>,
    ) -> Result<()> {
        yield_adapter::withdraw(ctx)
    }

    /// Permissionless crank: pays everyone out and closes the vault.
    /// Works for: auto-release after the claim window, resolved cases, and finished votes.
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        let cfg = &ctx.accounts.config;
        let now = Clock::get()?.unix_timestamp;

        require!(!ctx.accounts.tenancy.yield_active, UrError::YieldStillDeployed);
        let award = {
            let t = &ctx.accounts.tenancy;
            match t.status {
                TenancyStatus::Active => {
                    require!(has_ended(t)?, UrError::NotEnded);
                    require!(now >= t.end_ts + cfg.claim_window_secs, UrError::ClaimWindowOpen);
                    0 // nobody claimed → automatic full refund
                }
                TenancyStatus::Resolved => t.landlord_award,
                TenancyStatus::Claimed => {
                    require!(now >= t.voting_ends_ts, UrError::VotingOpen);
                    if t.vote_count >= cfg.quorum {
                        let mut v = t.votes[..t.vote_count as usize].to_vec();
                        math::lower_median(&mut v).unwrap_or(0)
                    } else {
                        0 // no quorum → landlord has not met burden of proof
                    }
                }
            }
        };

        let agent_key = ctx.accounts.tenancy.agent;
        let has_agent = agent_key != Pubkey::default();
        if has_agent {
            let at = ctx.accounts.agent_token.as_ref().ok_or(UrError::AgentAccountMissing)?;
            require_keys_eq!(at.owner, agent_key, UrError::AgentAccountMissing);
            require_keys_eq!(at.mint, ctx.accounts.mint.key(), UrError::AgentAccountMissing);
        }
        let p = math::compute_payout(
            ctx.accounts.vault.amount,
            ctx.accounts.tenancy.principal,
            award,
            &cfg.yield_split,
            has_agent,
        );

        let tenant_key = ctx.accounts.tenancy.tenant;
        let landlord_key = ctx.accounts.tenancy.landlord;
        let id_bytes = ctx.accounts.tenancy.tenancy_id.to_le_bytes();
        let bump = [ctx.accounts.tenancy.bump];
        let seeds: &[&[u8]] = &[
            TENANCY_SEED,
            tenant_key.as_ref(),
            landlord_key.as_ref(),
            &id_bytes,
            &bump,
        ];
        let signer = &[seeds];

        let a = &ctx.accounts;
        pay_from_vault(a, a.landlord_token.to_account_info(), p.landlord, signer)?;
        if let Some(at) = a.agent_token.as_ref() {
            pay_from_vault(a, at.to_account_info(), p.agent, signer)?;
        }
        pay_from_vault(a, a.treasury.to_account_info(), p.protocol, signer)?;
        pay_from_vault(a, a.tenant_token.to_account_info(), p.tenant, signer)?;

        token_interface::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.tenant.to_account_info(),
                authority: ctx.accounts.tenancy.to_account_info(),
            },
            signer,
        ))?;

        emit!(Settled {
            tenancy: ctx.accounts.tenancy.key(),
            to_tenant: p.tenant,
            to_landlord: p.landlord,
            to_agent: p.agent,
            to_protocol: p.protocol,
        });
        Ok(())
    }
}

fn pay_from_vault<'info>(
    a: &Settle<'info>,
    to: AccountInfo<'info>,
    amount: u64,
    signer: &[&[&[u8]]],
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            a.token_program.to_account_info(),
            TransferChecked {
                from: a.vault.to_account_info(),
                mint: a.mint.to_account_info(),
                to,
                authority: a.tenancy.to_account_info(),
            },
            signer,
        ),
        amount,
        a.mint.decimals,
    )
}

fn has_ended(t: &Tenancy) -> Result<bool> {
    Ok(t.end_ts != 0 && Clock::get()?.unix_timestamp >= t.end_ts)
}

// ---------------------------------------------------------------- accounts

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(token::mint = mint)]
    pub treasury: InterfaceAccount<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct DaoOnly<'info> {
    pub dao_authority: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = dao_authority)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
#[instruction(tenancy_id: u64)]
pub struct CreateTenancy<'info> {
    #[account(mut)]
    pub tenant: Signer<'info>,
    /// CHECK: only the landlord's address is recorded.
    pub landlord: UncheckedAccount<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = tenant,
        space = 8 + Tenancy::INIT_SPACE,
        seeds = [TENANCY_SEED, tenant.key().as_ref(), landlord.key().as_ref(), &tenancy_id.to_le_bytes()],
        bump
    )]
    pub tenancy: Box<Account<'info, Tenancy>>,
    #[account(
        init,
        payer = tenant,
        associated_token::mint = mint,
        associated_token::authority = tenancy,
        associated_token::token_program = token_program
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = tenant, token::token_program = token_program)]
    pub tenant_token: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PartyAction<'info> {
    pub signer: Signer<'info>,
    #[account(mut)]
    pub tenancy: Box<Account<'info, Tenancy>>,
}

#[derive(Accounts)]
pub struct LandlordAction<'info> {
    pub landlord: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, has_one = landlord)]
    pub tenancy: Box<Account<'info, Tenancy>>,
}

#[derive(Accounts)]
pub struct TenantAction<'info> {
    pub tenant: Signer<'info>,
    #[account(mut, has_one = tenant)]
    pub tenancy: Box<Account<'info, Tenancy>>,
}

#[derive(Accounts)]
pub struct CastVote<'info> {
    pub juror: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut)]
    pub tenancy: Box<Account<'info, Tenancy>>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    /// Anyone can crank settlement (a keeper bot in production).
    pub cranker: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = mint, has_one = treasury)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, close = tenant, has_one = tenant, has_one = landlord, has_one = mint)]
    pub tenancy: Box<Account<'info, Tenancy>>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = tenancy,
        associated_token::token_program = token_program
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: verified by `has_one = tenant`; receives rent from closed accounts.
    #[account(mut)]
    pub tenant: UncheckedAccount<'info>,
    /// CHECK: verified by `has_one = landlord`.
    pub landlord: UncheckedAccount<'info>,
    #[account(mut, token::mint = mint, token::authority = tenant, token::token_program = token_program)]
    pub tenant_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = landlord, token::token_program = token_program)]
    pub landlord_token: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Required only when the tenancy has an agent (checked in the handler).
    #[account(mut)]
    pub agent_token: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub treasury: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

// ---------------------------------------------------------------- events

#[event]
pub struct DepositLocked {
    pub tenancy: Pubkey,
    pub tenant: Pubkey,
    pub landlord: Pubkey,
    pub agent: Pubkey,
    pub principal: u64,
    pub end_ts: i64,
}
#[event]
pub struct NoticeServed {
    pub tenancy: Pubkey,
    pub by: Pubkey,
    pub end_ts: i64,
}
#[event]
pub struct ReleaseApproved {
    pub tenancy: Pubkey,
}
#[event]
pub struct ClaimRaised {
    pub tenancy: Pubkey,
    pub amount: u64,
    pub evidence_hash: [u8; 32],
    pub evidence_uri: String,
    pub voting_ends_ts: i64,
}
#[event]
pub struct ClaimAccepted {
    pub tenancy: Pubkey,
    pub amount: u64,
}
#[event]
pub struct TenantEvidence {
    pub tenancy: Pubkey,
    pub evidence_hash: [u8; 32],
    pub evidence_uri: String,
}
#[event]
pub struct VoteCast {
    pub tenancy: Pubkey,
    pub juror: Pubkey,
    pub award: u64,
}
#[event]
pub struct Settled {
    pub tenancy: Pubkey,
    pub to_tenant: u64,
    pub to_landlord: u64,
    pub to_agent: u64,
    pub to_protocol: u64,
}
