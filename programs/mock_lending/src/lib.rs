//! TEST ONLY: a stand-in for Jupiter Lend Earn with the same instruction names
//! (so the same discriminators) and the same account order.
//! Deposits are taken into a vault and 1:1 share tokens are minted.
//! Withdraw burns all shares and pays back 103% (simulated 3% interest from a pre-funded reserve).
//! Never deploy this anywhere but a local validator.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Burn, Mint, MintTo, TokenAccount, TokenInterface, TransferChecked};

declare_id!("73ZmGvzn29yTfZqwebHh8cXrcNS6TFRxXWVu5rKyYpWQ");

pub const AUTH_SEED: &[u8] = b"auth";
pub const INTEREST_BPS: u64 = 300; // 3%

#[program]
pub mod mock_lending {
    use super::*;

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let a = &ctx.accounts;
        let amount = if amount == u64::MAX { a.depositor_token_account.amount } else { amount };
        token_interface::transfer_checked(
            CpiContext::new(
                a.token_program.to_account_info(),
                TransferChecked {
                    from: a.depositor_token_account.to_account_info(),
                    mint: a.mint.to_account_info(),
                    to: a.vault.to_account_info(),
                    authority: a.signer.to_account_info(),
                },
            ),
            amount,
            a.mint.decimals,
        )?;
        let bump = [ctx.bumps.auth];
        let seeds: &[&[u8]] = &[AUTH_SEED, &bump];
        token_interface::mint_to(
            CpiContext::new_with_signer(
                a.token_program.to_account_info(),
                MintTo {
                    mint: a.f_token_mint.to_account_info(),
                    to: a.recipient_token_account.to_account_info(),
                    authority: a.auth.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let a = &ctx.accounts;
        let shares = if amount == u64::MAX { a.owner_token_account.amount } else { amount };
        token_interface::burn(
            CpiContext::new(
                a.token_program.to_account_info(),
                Burn {
                    mint: a.f_token_mint.to_account_info(),
                    from: a.owner_token_account.to_account_info(),
                    authority: a.signer.to_account_info(),
                },
            ),
            shares,
        )?;
        let payout = shares + shares * INTEREST_BPS / 10_000;
        let bump = [ctx.bumps.auth];
        let seeds: &[&[u8]] = &[AUTH_SEED, &bump];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                a.token_program.to_account_info(),
                TransferChecked {
                    from: a.vault.to_account_info(),
                    mint: a.mint.to_account_info(),
                    to: a.recipient_token_account.to_account_info(),
                    authority: a.auth.to_account_info(),
                },
                &[seeds],
            ),
            payout,
            a.mint.decimals,
        )
    }
}

// Account order mirrors Jupiter Lend Earn's deposit CPI (17 accounts).
#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(mut)]
    pub depositor_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub recipient_token_account: InterfaceAccount<'info, TokenAccount>,
    pub mint: InterfaceAccount<'info, Mint>,
    /// CHECK: in the real protocol, lending_admin. Here: the mock's authority PDA.
    #[account(seeds = [AUTH_SEED], bump)]
    pub auth: UncheckedAccount<'info>,
    /// CHECK: unused placeholder (lending)
    pub lending: UncheckedAccount<'info>,
    #[account(mut)]
    pub f_token_mint: InterfaceAccount<'info, Mint>,
    /// CHECK: unused placeholder
    pub supply_token_reserves_liquidity: UncheckedAccount<'info>,
    /// CHECK: unused placeholder
    pub lending_supply_position_on_liquidity: UncheckedAccount<'info>,
    /// CHECK: unused placeholder
    pub rate_model: UncheckedAccount<'info>,
    #[account(mut, token::authority = auth)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: unused placeholder
    pub liquidity: UncheckedAccount<'info>,
    /// CHECK: unused placeholder
    pub liquidity_program: UncheckedAccount<'info>,
    /// CHECK: unused placeholder
    pub rewards_rate_model: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    /// CHECK: unused placeholder
    pub associated_token_program: UncheckedAccount<'info>,
    /// CHECK: unused placeholder
    pub system_program: UncheckedAccount<'info>,
}

// Account order mirrors Jupiter Lend Earn's withdraw CPI (18 accounts).
#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(mut)]
    pub owner_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub recipient_token_account: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: in the real protocol, lending_admin. Here: the mock's authority PDA.
    #[account(seeds = [AUTH_SEED], bump)]
    pub auth: UncheckedAccount<'info>,
    /// CHECK: unused placeholder (lending)
    pub lending: UncheckedAccount<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub f_token_mint: InterfaceAccount<'info, Mint>,
    /// CHECK: unused placeholder
    pub supply_token_reserves_liquidity: UncheckedAccount<'info>,
    /// CHECK: unused placeholder
    pub lending_supply_position_on_liquidity: UncheckedAccount<'info>,
    /// CHECK: unused placeholder
    pub rate_model: UncheckedAccount<'info>,
    #[account(mut, token::authority = auth)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: unused placeholder
    pub claim_account: UncheckedAccount<'info>,
    /// CHECK: unused placeholder
    pub liquidity: UncheckedAccount<'info>,
    /// CHECK: unused placeholder
    pub liquidity_program: UncheckedAccount<'info>,
    /// CHECK: unused placeholder
    pub rewards_rate_model: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    /// CHECK: unused placeholder
    pub associated_token_program: UncheckedAccount<'info>,
    /// CHECK: unused placeholder
    pub system_program: UncheckedAccount<'info>,
}
