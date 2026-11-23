//! Pure settlement maths, kept free of Anchor types so it can be unit-tested directly.

use anchor_lang::prelude::*;

pub const BPS_DENOMINATOR: u64 = 10_000;

/// How yield (never principal) is shared. Must sum to 10,000 bps.
/// Default: 70% tenant / 20% landlord / 5% agent / 5% UltraRentz.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub struct YieldSplit {
    pub tenant_bps: u16,
    pub landlord_bps: u16,
    pub agent_bps: u16,
    pub protocol_bps: u16,
}

impl YieldSplit {
    pub fn is_valid(&self) -> bool {
        self.tenant_bps as u64 + self.landlord_bps as u64 + self.agent_bps as u64 + self.protocol_bps as u64
            == BPS_DENOMINATOR
    }
}

/// How a vault balance is split at settlement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Payout {
    pub tenant: u64,
    /// Deduction award + landlord's yield share.
    pub landlord: u64,
    pub agent: u64,
    pub protocol: u64,
}

/// Split the vault.
///
/// * Principal: landlord gets `landlord_award` (capped), tenant gets the rest.
/// * Yield (balance above principal): shared by `split`. With no agent on the tenancy,
///   the agent's share goes to the tenant.
/// * Rounding dust goes to the tenant.
/// * If the vault holds less than principal (lending-market loss), there is no yield,
///   and the landlord award is capped at what is there.
pub fn compute_payout(
    balance: u64,
    principal: u64,
    landlord_award: u64,
    split: &YieldSplit,
    has_agent: bool,
) -> Payout {
    let award = landlord_award.min(principal).min(balance);
    let yield_amount = balance.saturating_sub(principal);
    let share = |bps: u16| (yield_amount as u128 * bps as u128 / BPS_DENOMINATOR as u128) as u64;

    let landlord_yield = share(split.landlord_bps);
    let agent = if has_agent { share(split.agent_bps) } else { 0 };
    let protocol = share(split.protocol_bps);
    let landlord = award + landlord_yield;
    let tenant = balance - landlord - agent - protocol;
    Payout { tenant, landlord, agent, protocol }
}

/// Lower median of juror awards. The lower median leans towards the tenant,
/// which matches the rule that the burden of proof sits with the landlord.
pub fn lower_median(votes: &mut [u64]) -> Option<u64> {
    if votes.is_empty() {
        return None;
    }
    votes.sort_unstable();
    Some(votes[(votes.len() - 1) / 2])
}

#[cfg(test)]
mod tests {
    use super::*;

    const SPLIT: YieldSplit = YieldSplit { tenant_bps: 7_000, landlord_bps: 2_000, agent_bps: 500, protocol_bps: 500 };

    fn total(p: &Payout) -> u64 {
        p.tenant + p.landlord + p.agent + p.protocol
    }

    #[test]
    fn split_must_sum_to_100_percent() {
        assert!(SPLIT.is_valid());
        assert!(!YieldSplit { tenant_bps: 7_000, landlord_bps: 2_000, agent_bps: 1_000, protocol_bps: 500 }.is_valid());
    }

    #[test]
    fn full_refund_no_yield() {
        let p = compute_payout(1_000, 1_000, 0, &SPLIT, true);
        assert_eq!(p, Payout { tenant: 1_000, landlord: 0, agent: 0, protocol: 0 });
    }

    #[test]
    fn yield_split_70_20_5_5_with_agent() {
        // 1,200 deposit, 36 yield → tenant 25.2, landlord 7.2, agent 1.8, protocol 1.8
        let p = compute_payout(1_236_000_000, 1_200_000_000, 0, &SPLIT, true);
        assert_eq!(p, Payout { tenant: 1_225_200_000, landlord: 7_200_000, agent: 1_800_000, protocol: 1_800_000 });
        assert_eq!(total(&p), 1_236_000_000);
    }

    #[test]
    fn no_agent_share_goes_to_tenant() {
        let p = compute_payout(1_236_000_000, 1_200_000_000, 0, &SPLIT, false);
        assert_eq!(p, Payout { tenant: 1_227_000_000, landlord: 7_200_000, agent: 0, protocol: 1_800_000 });
    }

    #[test]
    fn deduction_plus_yield() {
        let p = compute_payout(1_236_000_000, 1_200_000_000, 200_000_000, &SPLIT, true);
        assert_eq!(p.landlord, 207_200_000); // 200 award + 7.2 yield share
        assert_eq!(p.tenant, 1_025_200_000);
        assert_eq!(total(&p), 1_236_000_000);
    }

    #[test]
    fn award_capped_at_principal() {
        let p = compute_payout(1_000, 1_000, 5_000, &SPLIT, true);
        assert_eq!(p.landlord, 1_000);
        assert_eq!(p.tenant, 0);
    }

    #[test]
    fn loss_in_vault_never_underflows() {
        let p = compute_payout(900, 1_000, 950, &SPLIT, true);
        assert_eq!(p, Payout { tenant: 0, landlord: 900, agent: 0, protocol: 0 });
    }

    #[test]
    fn rounding_dust_goes_to_tenant() {
        let p = compute_payout(1_007, 1_000, 0, &SPLIT, true); // 7 units of yield
        assert_eq!(total(&p), 1_007);
        assert!(p.tenant >= 1_004);
    }

    #[test]
    fn median_odd_and_even() {
        assert_eq!(lower_median(&mut [300, 100, 200]), Some(200));
        assert_eq!(lower_median(&mut [400, 100, 300, 200]), Some(200));
        assert_eq!(lower_median(&mut []), None);
    }
}
