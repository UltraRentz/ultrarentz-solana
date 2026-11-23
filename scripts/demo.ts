/**
 * UltraRentz demo scenarios.
 *
 *   npm run demo -- dispute   # landlord claims, 3 DAO jurors vote, settle (Week 1 flow)
 *   npm run demo -- auto      # landlord stays silent → keeper auto-refunds tenant with yield
 *   npm run demo -- release   # landlord one-click approves → keeper pays tenant immediately
 *   npm run demo -- all       # run all three
 */
import { BN } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import { getAccount, getOrCreateAssociatedTokenAccount, mintTo, transfer } from "@solana/spl-token";
import { createHash } from "crypto";
import {
  Ctx, loadProgram, ensureConfig, fund, createTenancy, waitForChainTime, log, fmt, UNIT, DEMO_WINDOW_SECS,
} from "./common";
import { runOnce } from "./keeper";

const DEPOSIT = 1_200 * UNIT;
const YIELD = 36 * UNIT;

async function addYield(ctx: Ctx, mint: any, vault: any) {
  const ata = await getOrCreateAssociatedTokenAccount(ctx.conn, ctx.admin, mint, ctx.admin.publicKey);
  await mintTo(ctx.conn, ctx.admin, mint, ata.address, ctx.admin, YIELD);
  return transfer(ctx.conn, ctx.admin, ata.address, vault, ctx.admin, YIELD);
}

async function balance(ctx: Ctx, mint: any, owner: any) {
  const ata = await getOrCreateAssociatedTokenAccount(ctx.conn, ctx.admin, mint, owner);
  return (await getAccount(ctx.conn, ata.address)).amount;
}

async function keeperUntilSettled(ctx: Ctx) {
  for (let i = 0; i < 10; i++) {
    if ((await runOnce(ctx)) > 0) return;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("Keeper did not settle in time");
}

async function scenarioDispute(ctx: Ctx, mint: any, jurors: Keypair[]) {
  console.log("\n━━━━━━━━ Scenario 1: Dispute decided by the DAO ━━━━━━━━");
  const tenant = Keypair.generate(), landlord = Keypair.generate();
  await fund(ctx, [tenant, landlord]);
  const t = await createTenancy(ctx, mint, tenant, landlord.publicKey, DEPOSIT, 15);
  log(ctx, `Tenant locked ${fmt(DEPOSIT)} tUSDC in escrow`, t.sig);
  log(ctx, `Vault earned ${fmt(YIELD)} tUSDC yield (simulated)`, await addYield(ctx, mint, t.vault));

  await waitForChainTime(ctx, t.endTs + 1);
  const evidence = "ipfs://demo/checkout-report-photos.zip";
  const hash = [...createHash("sha256").update(evidence).digest()];
  const claimSig = await ctx.program.methods
    .raiseClaim(new BN(300 * UNIT), hash, evidence)
    .accountsPartial({ landlord: landlord.publicKey, config: ctx.configPda, tenancy: t.tenancy })
    .signers([landlord])
    .rpc();
  log(ctx, "Landlord claimed 300.00 for damage, with evidence hash", claimSig);

  const votes = [150, 200, 300];
  for (let i = 0; i < jurors.length; i++) {
    const sig = await ctx.program.methods
      .castVote(new BN(votes[i] * UNIT))
      .accountsPartial({ juror: jurors[i].publicKey, config: ctx.configPda, tenancy: t.tenancy })
      .signers([jurors[i]])
      .rpc();
    log(ctx, `Juror ${i + 1} voted ${votes[i]}.00`, sig);
  }
  console.log(`\n⏳ Voting closes in ${DEMO_WINDOW_SECS}s — keeper will settle…`);
  const tenancy: any = await (ctx.program.account as any).tenancy.fetch(t.tenancy);
  await waitForChainTime(ctx, Number(tenancy.votingEndsTs) + 1);
  await keeperUntilSettled(ctx);
  console.log(`📊 Landlord ${fmt(await balance(ctx, mint, landlord.publicKey))} · Tenant ${fmt(await balance(ctx, mint, tenant.publicKey))}`);
}

async function scenarioAuto(ctx: Ctx, mint: any) {
  console.log("\n━━━━━━━━ Scenario 2: Landlord silent → automatic refund ━━━━━━━━");
  const tenant = Keypair.generate(), landlord = Keypair.generate();
  await fund(ctx, [tenant]);
  const t = await createTenancy(ctx, mint, tenant, landlord.publicKey, DEPOSIT, 15);
  log(ctx, `Tenant locked ${fmt(DEPOSIT)} tUSDC in escrow`, t.sig);
  log(ctx, `Vault earned ${fmt(YIELD)} tUSDC yield (simulated)`, await addYield(ctx, mint, t.vault));
  console.log(`\n⏳ Tenancy ends, then the ${DEMO_WINDOW_SECS}s claim window runs out with no claim…`);
  await waitForChainTime(ctx, t.endTs + DEMO_WINDOW_SECS + 1);
  await keeperUntilSettled(ctx);
  console.log(`📊 Tenant ${fmt(await balance(ctx, mint, tenant.publicKey))} (full deposit + yield − 10% fee on yield) · Landlord ${fmt(await balance(ctx, mint, landlord.publicKey))}`);
}

async function scenarioRelease(ctx: Ctx, mint: any) {
  console.log("\n━━━━━━━━ Scenario 3: Landlord one-click release ━━━━━━━━");
  const tenant = Keypair.generate(), landlord = Keypair.generate();
  await fund(ctx, [tenant, landlord]);
  const t = await createTenancy(ctx, mint, tenant, landlord.publicKey, DEPOSIT, 15);
  log(ctx, `Tenant locked ${fmt(DEPOSIT)} tUSDC in escrow`, t.sig);
  await waitForChainTime(ctx, t.endTs + 1);
  const sig = await ctx.program.methods
    .approveRelease()
    .accountsPartial({ landlord: landlord.publicKey, config: ctx.configPda, tenancy: t.tenancy })
    .signers([landlord])
    .rpc();
  log(ctx, "Landlord approved full release at move-out", sig);
  await keeperUntilSettled(ctx);
  console.log(`📊 Tenant ${fmt(await balance(ctx, mint, tenant.publicKey))} — paid out immediately, no waiting window`);
}

async function main() {
  const which = process.argv[2] ?? "all";
  const ctx = loadProgram();
  console.log(`Program ${ctx.program.programId.toBase58()} · RPC ${ctx.conn.rpcEndpoint}`);
  const jurors = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
  await fund(ctx, jurors);
  const mint = await ensureConfig(ctx, jurors.map((j) => j.publicKey));

  if (which === "dispute" || which === "all") await scenarioDispute(ctx, mint, jurors);
  if (which === "auto" || which === "all") await scenarioAuto(ctx, mint);
  if (which === "release" || which === "all") await scenarioRelease(ctx, mint);
  console.log("\n🎉 Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
