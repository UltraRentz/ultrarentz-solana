use anchor_lang::prelude::*;

use crate::math::YieldSplit;

pub const MAX_JURORS: usize = 9;
pub const CONFIG_SEED: &[u8] = b"config";
pub const TENANCY_SEED: &[u8] = b"tenancy";
pub const AGENT_SEED: &[u8] = b"agent";

/// Global protocol settings (one per deployment).
#[account]
#[derive(InitSpace)]
pub struct Config {
    /// Can change economic parameters.
    pub admin: Pubkey,
    /// Controls the juror set. Start as Ben's wallet; move to a Squads multisig / Realms DAO in the sprint.
    pub dao_authority: Pubkey,
    /// Deposit currency (USDC on mainnet, a test mint on devnet).
    pub mint: Pubkey,
    /// Token account that receives the protocol's cut of yield.
    pub treasury: Pubkey,
    /// How yield is shared (tenant / landlord / agent / UltraRentz). Principal is never split.
    pub yield_split: YieldSplit,
    /// After tenancy end, how long the landlord has to raise a claim before auto-release.
    pub claim_window_secs: i64,
    /// How long jurors have to vote once a claim is raised.
    pub voting_period_secs: i64,
    /// Lending program the vault deposits into (Jupiter Lend Earn). `Pubkey::default()` = no external yield.
    pub yield_program: Pubkey,
    /// Minimum votes for a DAO decision. Below quorum the tenant gets the full deposit.
    pub quorum: u8,
    pub juror_count: u8,
    pub jurors: [Pubkey; MAX_JURORS],
    pub bump: u8,
}

impl Config {
    pub fn is_juror(&self, key: &Pubkey) -> bool {
        self.jurors[..self.juror_count as usize].contains(key)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum TenancyStatus {
    /// Deposit locked and earning.
    Active,
    /// Landlord raised a deduction claim; DAO jurors can vote.
    Claimed,
    /// Outcome fixed (landlord approved release or tenant accepted claim); waiting for `settle`.
    Resolved,
}

/// One deposit for one tenancy. PDA: ["tenancy", tenant, landlord, tenancy_id].
#[account]
#[derive(InitSpace)]
pub struct Tenancy {
    pub tenant: Pubkey,
    pub landlord: Pubkey,
    /// Letting agent that onboarded this deposit; `Pubkey::default()` = no agent.
    pub agent: Pubkey,
    pub mint: Pubkey,
    pub tenancy_id: u64,
    pub principal: u64,
    pub start_ts: i64,
    /// 0 = periodic / rolling tenancy with no end date yet (set later via `serve_notice`).
    pub end_ts: i64,
    pub status: TenancyStatus,

    // ---- dispute ----
    pub claim_amount: u64,
    /// Hash of the landlord's evidence bundle (photos, inventory, invoices) stored off-chain.
    pub landlord_evidence: [u8; 32],
    /// Hash of the tenant's counter-evidence. Optional: an absent tenant is NOT penalised.
    pub tenant_evidence: [u8; 32],
    pub voting_ends_ts: i64,
    pub vote_count: u8,
    pub voters: [Pubkey; MAX_JURORS],
    pub votes: [u64; MAX_JURORS],

    /// Final amount going to the landlord once Resolved.
    pub landlord_award: u64,
    /// True while the deposit sits in the lending market; must be withdrawn before `settle`.
    pub yield_active: bool,
    /// Token account (owned by this tenancy PDA) holding the lending market's share tokens.
    pub yield_shares_account: Pubkey,
    /// The landlord has authorised the tenancy's agent to act for them (approve release, raise claims).
    pub agent_approved: bool,
    pub bump: u8,
}

/// A letting agent approved by UltraRentz. PDA: ["agent", agent wallet].
#[account]
#[derive(InitSpace)]
pub struct AgentProfile {
    pub agent: Pubkey,
    #[max_len(40)]
    pub name: String,
    /// UltraRentz can suspend an agent; a suspended agent can't act for anyone.
    pub active: bool,
    pub registered_ts: i64,
    pub bump: u8,
}
