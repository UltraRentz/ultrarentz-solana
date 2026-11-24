//! Yield adapter: parks the deposit in a Solana lending market (Jupiter Lend Earn) while the
//! tenancy runs, and pulls principal + interest back before settlement.
//!
//! We call the lending program with a raw CPI (discriminator + u64 amount), so there is no
//! crate dependency to drift out of date. The client resolves the lending program's accounts
//! (Jupiter's `getDepositContext` / `getWithdrawContext`) and passes them as `remaining_accounts`
//! in the program's documented order. We pin the security-critical ones:
//!   * the signer is this tenancy's PDA (only it can move the vault or the share tokens),
//!   * money only moves vault ⇄ this tenancy's share account,
//!   * the mints match, and the program ID is the one the admin configured.
//!
//! Account orders: https://developers.jup.ag/docs/lend/earn/cpi

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, CloseAccount, Mint, TokenAccount, TokenInterface};

use crate::errors::UrError;
use crate::state::*;

/// sha256("global:deposit")[0..8]
pub const DEPOSIT_DISCRIMINATOR: [u8; 8] = [242, 35, 198, 137, 82, 225, 242, 182];
/// sha256("global:withdraw")[0..8]
pub const WITHDRAW_DISCRIMINATOR: [u8; 8] = [183, 18, 70, 156, 148, 109, 161, 34];

pub const DEPOSIT_ACCOUNTS: usize = 17;
pub const WITHDRAW_ACCOUNTS: usize = 18;

fn build_ix(program_id: Pubkey, rem: &[AccountInfo], data: Vec<u8>) -> Instruction {
    let accounts = rem
        .iter()
        .enumerate()
        .map(|(i, a)| {
            if i == 0 {
                AccountMeta::new(a.key(), true) // tenancy PDA signs via invoke_signed
            } else if a.is_writable {
                AccountMeta::new(a.key(), false)
            } else {
                AccountMeta::new_readonly(a.key(), false)
            }
        })
        .collect();
    Instruction { program_id, accounts, data }
}

fn ended(t: &Tenancy) -> Result<bool> {
    Ok(t.end_ts != 0 && Clock::get()?.unix_timestamp >= t.end_ts)
}

pub fn deposit<'info>(ctx: Context<'_, '_, 'info, 'info, DepositToYield<'info>>) -> Result<()> {
    let t = &ctx.accounts.tenancy;
    require!(t.status == TenancyStatus::Active, UrError::WrongStatus);
    require!(!t.yield_active, UrError::YieldAlreadyActive);
    require!(!ended(t)?, UrError::WrongStatus);

    let rem = ctx.remaining_accounts;
    require!(rem.len() == DEPOSIT_ACCOUNTS, UrError::BadYieldAccounts);
    require_keys_eq!(rem[0].key(), t.key(), UrError::BadYieldAccounts); // signer
    require_keys_eq!(rem[1].key(), ctx.accounts.vault.key(), UrError::BadYieldAccounts); // from
    require_keys_eq!(rem[2].key(), ctx.accounts.shares_account.key(), UrError::BadYieldAccounts); // shares to
    require_keys_eq!(rem[3].key(), ctx.accounts.mint.key(), UrError::BadYieldAccounts);
    require_keys_eq!(rem[6].key(), ctx.accounts.f_token_mint.key(), UrError::BadYieldAccounts);

    let amount = ctx.accounts.vault.amount;
    let mut data = DEPOSIT_DISCRIMINATOR.to_vec();
    data.extend_from_slice(&amount.to_le_bytes());
    let ix = build_ix(ctx.accounts.lending_program.key(), rem, data);

    let (tenant, landlord, id, bump) = (t.tenant, t.landlord, t.tenancy_id.to_le_bytes(), [t.bump]);
    let seeds: &[&[u8]] = &[TENANCY_SEED, tenant.as_ref(), landlord.as_ref(), &id, &bump];
    let mut infos = rem.to_vec();
    infos.push(ctx.accounts.lending_program.to_account_info());
    invoke_signed(&ix, &infos, &[seeds])?;

    let t = &mut ctx.accounts.tenancy;
    t.yield_active = true;
    t.yield_shares_account = ctx.accounts.shares_account.key();
    emit!(YieldDeposited { tenancy: t.key(), amount, lending_program: ctx.accounts.lending_program.key() });
    Ok(())
}

pub fn withdraw<'info>(ctx: Context<'_, '_, 'info, 'info, WithdrawFromYield<'info>>) -> Result<()> {
    let t = &ctx.accounts.tenancy;
    require!(t.yield_active, UrError::YieldNotActive);
    // Only once the tenancy is over (or resolved / disputed) — stops anyone pulling funds early.
    require!(t.status != TenancyStatus::Active || ended(t)?, UrError::NotEnded);

    let rem = ctx.remaining_accounts;
    require!(rem.len() == WITHDRAW_ACCOUNTS, UrError::BadYieldAccounts);
    require_keys_eq!(rem[0].key(), t.key(), UrError::BadYieldAccounts); // signer
    require_keys_eq!(rem[1].key(), ctx.accounts.shares_account.key(), UrError::BadYieldAccounts); // shares burned
    require_keys_eq!(rem[2].key(), ctx.accounts.vault.key(), UrError::BadYieldAccounts); // assets to vault
    require_keys_eq!(rem[5].key(), ctx.accounts.mint.key(), UrError::BadYieldAccounts);
    require_keys_eq!(rem[6].key(), ctx.accounts.f_token_mint.key(), UrError::BadYieldAccounts);

    let before = ctx.accounts.vault.amount;
    let mut data = WITHDRAW_DISCRIMINATOR.to_vec();
    data.extend_from_slice(&u64::MAX.to_le_bytes()); // u64::MAX = withdraw everything
    let ix = build_ix(ctx.accounts.lending_program.key(), rem, data);

    let (tenant, landlord, id, bump) = (t.tenant, t.landlord, t.tenancy_id.to_le_bytes(), [t.bump]);
    let seeds: &[&[u8]] = &[TENANCY_SEED, tenant.as_ref(), landlord.as_ref(), &id, &bump];
    let mut infos = rem.to_vec();
    infos.push(ctx.accounts.lending_program.to_account_info());
    invoke_signed(&ix, &infos, &[seeds])?;

    ctx.accounts.vault.reload()?;
    ctx.accounts.shares_account.reload()?;
    let received = ctx.accounts.vault.amount.saturating_sub(before);

    // Return the empty share account's rent to whoever paid for this transaction.
    if ctx.accounts.shares_account.amount == 0 {
        token_interface::close_account(CpiContext::new_with_signer(
            ctx.accounts.shares_token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.shares_account.to_account_info(),
                destination: ctx.accounts.payer.to_account_info(),
                authority: ctx.accounts.tenancy.to_account_info(),
            },
            &[seeds],
        ))?;
    }

    let t = &mut ctx.accounts.tenancy;
    t.yield_active = false;
    emit!(YieldWithdrawn {
        tenancy: t.key(),
        received,
        interest: received.saturating_sub(t.principal),
    });
    Ok(())
}

#[derive(Accounts)]
pub struct DepositToYield<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, has_one = mint)]
    pub tenancy: Box<Account<'info, Tenancy>>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = tenancy,
        associated_token::token_program = token_program
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// The lending market's share token (Jupiter: jlToken).
    pub f_token_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = f_token_mint,
        associated_token::authority = tenancy,
        associated_token::token_program = shares_token_program
    )]
    pub shares_account: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: must be the lending program the admin configured.
    #[account(
        constraint = config.yield_program != Pubkey::default() @ UrError::YieldNotConfigured,
        constraint = lending_program.key() == config.yield_program @ UrError::YieldNotConfigured,
        executable
    )]
    pub lending_program: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub shares_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawFromYield<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, has_one = mint, constraint = tenancy.yield_shares_account == shares_account.key() @ UrError::BadYieldAccounts)]
    pub tenancy: Box<Account<'info, Tenancy>>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = tenancy,
        associated_token::token_program = token_program
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub f_token_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = f_token_mint,
        associated_token::authority = tenancy,
        associated_token::token_program = shares_token_program
    )]
    pub shares_account: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: must be the lending program the admin configured.
    #[account(
        constraint = lending_program.key() == config.yield_program @ UrError::YieldNotConfigured,
        executable
    )]
    pub lending_program: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub shares_token_program: Interface<'info, TokenInterface>,
}

#[event]
pub struct YieldDeposited {
    pub tenancy: Pubkey,
    pub amount: u64,
    pub lending_program: Pubkey,
}

#[event]
pub struct YieldWithdrawn {
    pub tenancy: Pubkey,
    pub received: u64,
    pub interest: u64,
}
