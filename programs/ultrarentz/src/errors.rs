use anchor_lang::prelude::*;

#[error_code]
pub enum UrError {
    #[msg("Deposit must be greater than zero")]
    ZeroDeposit,
    #[msg("Tenant and landlord must be different wallets")]
    SameParty,
    #[msg("Signer is not a party to this tenancy")]
    NotAParty,
    #[msg("Tenancy is not in the required status for this action")]
    WrongStatus,
    #[msg("End date has already been set")]
    EndAlreadySet,
    #[msg("End date must not be in the past")]
    EndInPast,
    #[msg("Tenancy has not ended yet")]
    NotEnded,
    #[msg("The landlord claim window has closed")]
    ClaimWindowClosed,
    #[msg("The landlord claim window is still open")]
    ClaimWindowOpen,
    #[msg("Claim must be > 0 and <= the deposit")]
    InvalidClaim,
    #[msg("Signer is not an active juror")]
    NotJuror,
    #[msg("Parties to a tenancy cannot vote on it")]
    ConflictOfInterest,
    #[msg("Juror has already voted")]
    AlreadyVoted,
    #[msg("Voting period has ended")]
    VotingClosed,
    #[msg("Voting period is still open")]
    VotingOpen,
    #[msg("Award cannot exceed the claimed amount")]
    AwardTooHigh,
    #[msg("Too many jurors")]
    TooManyJurors,
    #[msg("Invalid parameter")]
    InvalidParam,
    #[msg("Yield split must add up to 100%")]
    InvalidSplit,
    #[msg("Agent token account missing or wrong")]
    AgentAccountMissing,
    #[msg("No lending program configured, or wrong lending program passed")]
    YieldNotConfigured,
    #[msg("Deposit is already in the lending market")]
    YieldAlreadyActive,
    #[msg("Deposit is not in the lending market")]
    YieldNotActive,
    #[msg("Withdraw the deposit from the lending market before settling")]
    YieldStillDeployed,
    #[msg("Lending accounts passed in the wrong order or with wrong keys")]
    BadYieldAccounts,
    #[msg("Only the landlord, or an agent the landlord approved, can do this")]
    NotLandlordOrAgent,
    #[msg("This tenancy has no agent")]
    NoAgent,
    #[msg("Agent is not registered with UltraRentz, or is suspended")]
    AgentNotRegistered,
}
