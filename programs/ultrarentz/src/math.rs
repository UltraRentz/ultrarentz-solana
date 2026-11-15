//! Pure settlement maths, kept free of Anchor types so it can be unit-tested directly.

pub const BPS_DENOMINATOR: u64 = 10_000;

/// How a vault balance is split at settlement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Payout {
    pub tenant: u64,
    pub landlord: u64,
    pub protocol_fee: u64,
}

/// Split the vault.
///
/// * `balance`       – everything currently in the vault (principal + any yield)
/// * `principal`     – what the tenant originally deposited
/// * `landlord_award`– deduction awarded to the landlord (agreed or decided by the DAO)
/// * `fee_bps`       – protocol fee, charged on yield only, never on principal
///
/// Yield belongs to the tenant (minus the protocol fee). If the vault ever holds
/// less than principal (e.g. a lending-market loss), the landlord award is capped
/// at what is there, and the protocol takes nothing.
pub fn compute_payout(balance: u64, principal: u64, landlord_award: u64, fee_bps: u16) -> Payout {
    let landlord = landlord_award.min(principal).min(balance);
    let yield_amount = balance.saturating_sub(principal);
    let protocol_fee = (yield_amount as u128 * fee_bps as u128 / BPS_DENOMINATOR as u128) as u64;
    let tenant = balance - landlord - protocol_fee;
    Payout { tenant, landlord, protocol_fee }
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

    #[test]
    fn full_refund_no_yield() {
        let p = compute_payout(1_000, 1_000, 0, 1_000);
        assert_eq!(p, Payout { tenant: 1_000, landlord: 0, protocol_fee: 0 });
    }

    #[test]
    fn yield_goes_to_tenant_minus_fee() {
        // 1,000 deposited, 50 yield, 10% fee on yield
        let p = compute_payout(1_050, 1_000, 0, 1_000);
        assert_eq!(p, Payout { tenant: 1_045, landlord: 0, protocol_fee: 5 });
    }

    #[test]
    fn deduction_plus_yield() {
        let p = compute_payout(1_050, 1_000, 300, 1_000);
        assert_eq!(p, Payout { tenant: 745, landlord: 300, protocol_fee: 5 });
        assert_eq!(p.tenant + p.landlord + p.protocol_fee, 1_050);
    }

    #[test]
    fn award_capped_at_principal() {
        let p = compute_payout(1_000, 1_000, 5_000, 0);
        assert_eq!(p.landlord, 1_000);
        assert_eq!(p.tenant, 0);
    }

    #[test]
    fn loss_in_vault_never_underflows() {
        // vault lost value: 900 left of 1,000 principal, landlord awarded 950
        let p = compute_payout(900, 1_000, 950, 1_000);
        assert_eq!(p, Payout { tenant: 0, landlord: 900, protocol_fee: 0 });
    }

    #[test]
    fn median_odd_and_even() {
        assert_eq!(lower_median(&mut [300, 100, 200]), Some(200));
        assert_eq!(lower_median(&mut [400, 100, 300, 200]), Some(200)); // lower median favours tenant
        assert_eq!(lower_median(&mut []), None);
    }
}
