/**
 * Lending adapters: supply the lending program's accounts, in its exact instruction order,
 * for our program's `deposit_to_yield` / `withdraw_from_yield`.
 *
 *  - mock:    local test stand-in for Jupiter Lend Earn (programs/mock_lending), pays 3% on withdraw
 *  - jupiter: real Jupiter Lend Earn, via @jup-ag/lend (mainnet program IDs — use a mainnet fork
 *             such as Surfpool for testing; the SDK has no devnet markets)
 *
 * Account order (from Jupiter's IDL):
 *   deposit  (17): signer, depositor_token_account, recipient_token_account, mint, lending_admin, lending,
 *                  f_token_mint, supply_token_reserves_liquidity, lending_supply_position_on_liquidity,
 *                  rate_model, vault, liquidity, liquidity_program, rewards_rate_model, token_program,
 *                  associated_token_program, system_program
 *   withdraw (18): signer, owner_token_account, recipient_token_account, lending_admin, lending, mint,
 *                  f_token_mint, supply_token_reserves_liquidity, lending_supply_position_on_liquidity,
 *                  rate_model, vault, claim_account, liquidity, liquidity_program, rewards_rate_model,
 *                  token_program, associated_token_program, system_program
 */
import { AccountMeta, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import { Ctx } from "./common";

export const MOCK_LENDING_ID = new PublicKey("73ZmGvzn29yTfZqwebHh8cXrcNS6TFRxXWVu5rKyYpWQ");
export const JUPITER_LENDING_MAINNET = new PublicKey("jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9");

const w = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: true });
const r = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: false });

export interface LendingAdapter {
  name: string;
  programId: PublicKey;
  fTokenMint: PublicKey;
  sharesTokenProgram: PublicKey;
  depositAccounts(tenancy: PublicKey): Promise<AccountMeta[]>;
  withdrawAccounts(tenancy: PublicKey): Promise<AccountMeta[]>;
}

// ---------------------------------------------------------------- mock (local tests)

const STATE = path.join(__dirname, "..", ".demo", "mock-lending.json");

export async function mockAdapter(ctx: Ctx, mint: PublicKey): Promise<LendingAdapter> {
  const [auth] = PublicKey.findProgramAddressSync([Buffer.from("auth")], MOCK_LENDING_ID);
  let fTokenMint: PublicKey;
  const saved = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : null;
  if (saved && saved.mint === mint.toBase58() && (await ctx.conn.getAccountInfo(new PublicKey(saved.fTokenMint)))) {
    fTokenMint = new PublicKey(saved.fTokenMint);
  } else {
    fTokenMint = await createMint(ctx.conn, ctx.admin, auth, null, 6);
    fs.mkdirSync(path.dirname(STATE), { recursive: true });
    fs.writeFileSync(STATE, JSON.stringify({ mint: mint.toBase58(), fTokenMint: fTokenMint.toBase58() }));
  }
  const mockVault = (await getOrCreateAssociatedTokenAccount(ctx.conn, ctx.admin, mint, auth, true)).address;
  // Pre-fund the mock's interest reserve so it can pay 3% on withdrawals.
  await mintTo(ctx.conn, ctx.admin, mint, mockVault, ctx.admin, 10_000 * 1_000_000);
  const dummy = SystemProgram.programId;

  return {
    name: "mock (Jupiter-compatible)",
    programId: MOCK_LENDING_ID,
    fTokenMint,
    sharesTokenProgram: TOKEN_PROGRAM_ID,
    async depositAccounts(tenancy) {
      return [
        w(tenancy), w(getAssociatedTokenAddressSync(mint, tenancy, true)),
        w(getAssociatedTokenAddressSync(fTokenMint, tenancy, true)), r(mint), r(auth), r(dummy),
        w(fTokenMint), r(dummy), r(dummy), r(dummy), w(mockVault), r(dummy), r(dummy), r(dummy),
        r(TOKEN_PROGRAM_ID), r(ASSOCIATED_TOKEN_PROGRAM_ID), r(SystemProgram.programId),
      ];
    },
    async withdrawAccounts(tenancy) {
      return [
        w(tenancy), w(getAssociatedTokenAddressSync(fTokenMint, tenancy, true)),
        w(getAssociatedTokenAddressSync(mint, tenancy, true)), r(auth), r(dummy), r(mint),
        w(fTokenMint), r(dummy), r(dummy), r(dummy), w(mockVault), r(dummy), r(dummy), r(dummy),
        r(dummy), r(TOKEN_PROGRAM_ID), r(ASSOCIATED_TOKEN_PROGRAM_ID), r(SystemProgram.programId),
      ];
    },
  };
}

// ---------------------------------------------------------------- real Jupiter Lend Earn

// @jup-ag/lend is ESM-only; load it without TypeScript turning import() into require().
const esmImport = new Function("m", "return import(m)") as (m: string) => Promise<any>;

export async function jupiterAdapter(ctx: Ctx, mint: PublicKey): Promise<LendingAdapter> {
  const earn = await esmImport("@jup-ag/lend/earn");
  const probe = await earn.getDepositContext({ asset: mint, signer: PublicKey.default, connection: ctx.conn });
  return {
    name: "Jupiter Lend Earn",
    programId: JUPITER_LENDING_MAINNET,
    fTokenMint: probe.fTokenMint,
    sharesTokenProgram: probe.tokenProgram,
    async depositAccounts(tenancy) {
      const c = await earn.getDepositContext({ asset: mint, signer: tenancy, connection: ctx.conn });
      return [
        w(tenancy), w(c.depositorTokenAccount), w(c.recipientTokenAccount), r(c.mint), r(c.lendingAdmin),
        w(c.lending), w(c.fTokenMint), w(c.supplyTokenReservesLiquidity), w(c.lendingSupplyPositionOnLiquidity),
        r(c.rateModel), w(c.vault), w(c.liquidity), r(c.liquidityProgram), r(c.rewardsRateModel),
        r(c.tokenProgram), r(ASSOCIATED_TOKEN_PROGRAM_ID), r(SystemProgram.programId),
      ];
    },
    async withdrawAccounts(tenancy) {
      const c = await earn.getWithdrawContext({ asset: mint, signer: tenancy, connection: ctx.conn });
      return [
        w(tenancy), w(c.ownerTokenAccount), w(c.recipientTokenAccount), r(c.lendingAdmin), w(c.lending),
        r(c.mint), w(c.fTokenMint), w(c.supplyTokenReservesLiquidity), w(c.lendingSupplyPositionOnLiquidity),
        r(c.rateModel), w(c.vault), w(c.claimAccount), w(c.liquidity), r(c.liquidityProgram),
        r(c.rewardsRateModel), r(c.tokenProgram), r(ASSOCIATED_TOKEN_PROGRAM_ID), r(SystemProgram.programId),
      ];
    },
  };
}

/** Pick the adapter from the LENDING env var (mock | jupiter). */
export async function loadAdapter(ctx: Ctx, mint: PublicKey): Promise<LendingAdapter> {
  return (process.env.LENDING ?? "mock") === "jupiter" ? jupiterAdapter(ctx, mint) : mockAdapter(ctx, mint);
}

/** Instruction builders for our program's yield instructions. */
export async function depositToYieldIx(ctx: Ctx, a: LendingAdapter, tenancy: PublicKey, mint: PublicKey) {
  return ctx.program.methods
    .depositToYield()
    .accountsPartial({
      payer: ctx.admin.publicKey,
      config: ctx.configPda,
      tenancy,
      mint,
      vault: getAssociatedTokenAddressSync(mint, tenancy, true),
      fTokenMint: a.fTokenMint,
      sharesAccount: getAssociatedTokenAddressSync(a.fTokenMint, tenancy, true, a.sharesTokenProgram),
      lendingProgram: a.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      sharesTokenProgram: a.sharesTokenProgram,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(await a.depositAccounts(tenancy))
    .instruction();
}

export async function withdrawFromYieldIx(ctx: Ctx, a: LendingAdapter, tenancy: PublicKey, mint: PublicKey) {
  return ctx.program.methods
    .withdrawFromYield()
    .accountsPartial({
      payer: ctx.admin.publicKey,
      config: ctx.configPda,
      tenancy,
      mint,
      vault: getAssociatedTokenAddressSync(mint, tenancy, true),
      fTokenMint: a.fTokenMint,
      sharesAccount: getAssociatedTokenAddressSync(a.fTokenMint, tenancy, true, a.sharesTokenProgram),
      lendingProgram: a.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      sharesTokenProgram: a.sharesTokenProgram,
    })
    .remainingAccounts(await a.withdrawAccounts(tenancy))
    .instruction();
}
