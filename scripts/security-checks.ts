/**
 * Negative tests for the yield adapter: each attack must be rejected by the program.
 *   npm run security   (local validator with ultrarentz + mock_lending loaded)
 */
import { Keypair, PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { loadProgram, ensureConfig, fund, createTenancy, UNIT } from "./common";
import { loadAdapter, depositToYieldIx, withdrawFromYieldIx } from "./yield";

let passed = 0, failed = 0;
async function expectFail(name: string, code: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    console.log(`❌ ${name}: was NOT rejected`);
    failed++;
  } catch (e: any) {
    const msg = String(e?.message ?? e) + JSON.stringify(e?.logs ?? e?.transactionLogs ?? "");
    if (msg.includes(code)) { console.log(`✅ ${name} → rejected (${code})`); passed++; }
    else { console.log(`❌ ${name}: rejected for the wrong reason\n   ${msg.slice(0, 300)}`); failed++; }
  }
}

async function main() {
  const ctx = loadProgram();
  const mint = await ensureConfig(ctx, []);
  const adapter = await loadAdapter(ctx, mint);
  await ctx.program.methods.setYieldProgram(adapter.programId)
    .accountsPartial({ admin: ctx.admin.publicKey, config: ctx.configPda }).rpc();

  const tenant = Keypair.generate(), landlord = Keypair.generate();
  await fund(ctx, [tenant]);
  const t = await createTenancy(ctx, mint, tenant, landlord.publicKey, 1_000 * UNIT, 3600);
  const send = async (ix: any) => ctx.provider.sendAndConfirm(new Transaction().add(ix));

  // 1. Attacker swaps in their own token account as the "depositor" (vault) account.
  const attacker = Keypair.generate();
  const attackerAta = (await getOrCreateAssociatedTokenAccount(ctx.conn, ctx.admin, mint, attacker.publicKey)).address;
  await expectFail("Deposit with a substituted source account", "BadYieldAccounts", async () => {
    const ix = await depositToYieldIx(ctx, adapter, t.tenancy, mint);
    const k = ix.keys.length - 17 + 1; // remaining_accounts[1]
    ix.keys[k] = { pubkey: attackerAta, isSigner: false, isWritable: true };
    return send(ix);
  });

  // 2. Wrong lending program (not the one the admin configured).
  await expectFail("Deposit into an unapproved lending program", "YieldNotConfigured", async () => {
    const ix = await depositToYieldIx(ctx, adapter, t.tenancy, mint);
    const idx = ix.keys.findIndex((k) => k.pubkey.equals(adapter.programId));
    ix.keys[idx] = { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false };
    return send(ix);
  });

  // Legit deposit.
  await send(await depositToYieldIx(ctx, adapter, t.tenancy, mint));
  console.log("   (legit deposit into lending market succeeded)");

  // 3. Double deposit.
  await expectFail("Second deposit while already in the market", "YieldAlreadyActive", async () =>
    send(await depositToYieldIx(ctx, adapter, t.tenancy, mint)));

  // 4. Early withdrawal griefing (tenancy still running).
  await expectFail("Withdraw before the tenancy ends", "NotEnded", async () =>
    send(await withdrawFromYieldIx(ctx, adapter, t.tenancy, mint)));

  // 5. Settle while funds are still in the lending market.
  await expectFail("Settle while deposit is still in the lending market", "YieldStillDeployed", async () => {
    const cfg: any = await (ctx.program.account as any).config.fetch(ctx.configPda);
    const tenantAta = getAssociatedTokenAddressSync(mint, tenant.publicKey);
    const landlordAta = (await getOrCreateAssociatedTokenAccount(ctx.conn, ctx.admin, mint, landlord.publicKey)).address;
    return ctx.program.methods.settle().accountsPartial({
      cranker: ctx.admin.publicKey, config: ctx.configPda, mint, tenancy: t.tenancy, vault: t.vault,
      tenant: tenant.publicKey, landlord: landlord.publicKey, tenantToken: tenantAta,
      landlordToken: landlordAta, agentToken: null, treasury: cfg.treasury, tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
