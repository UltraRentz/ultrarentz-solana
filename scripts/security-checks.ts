/**
 * Negative tests for the yield adapter: each attack must be rejected by the program.
 *   npm run security   (local validator with ultrarentz + mock_lending loaded)
 */
import { Keypair, PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { loadProgram, ensureConfig, fund, createTenancy, waitForChainTime, UNIT } from "./common";
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

  // ---------------- Agents acting for landlords ----------------
  const agentPda = (k: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("agent"), k.toBuffer()], ctx.program.programId)[0];
  const asAgent = (who: Keypair, tenancy: PublicKey, withProfile: boolean) =>
    ctx.program.methods.approveRelease()
      .accountsPartial({ authority: who.publicKey, config: ctx.configPda, tenancy, agentProfile: withProfile ? agentPda(who.publicKey) : null })
      .signers([who]).rpc();

  // 6. Tenant names their OWN wallet as the "agent", then tries to release their own deposit.
  const t2 = Keypair.generate(), l2 = Keypair.generate();
  await fund(ctx, [t2, l2]);
  const selfAgent = await createTenancy(ctx, mint, t2, l2.publicKey, 500 * UNIT, 3, t2.publicKey);
  await waitForChainTime(ctx, selfAgent.endTs + 1);
  await expectFail("Tenant names themselves as agent and releases their own deposit", "NotLandlordOrAgent", () =>
    asAgent(t2, selfAgent.tenancy, false));

  // 7. A registered agent the landlord has NOT approved.
  const agent = Keypair.generate();
  await fund(ctx, [agent]);
  await ctx.program.methods.registerAgent("Test Lettings")
    .accountsPartial({ admin: ctx.admin.publicKey, config: ctx.configPda, agent: agent.publicKey, agentProfile: agentPda(agent.publicKey), systemProgram: SystemProgram.programId }).rpc();
  const t3 = Keypair.generate(), l3 = Keypair.generate();
  await fund(ctx, [t3, l3]);
  const withAgent = await createTenancy(ctx, mint, t3, l3.publicKey, 500 * UNIT, 3, agent.publicKey);
  await waitForChainTime(ctx, withAgent.endTs + 1);
  await expectFail("Registered agent acts before the landlord approves them", "NotLandlordOrAgent", () =>
    asAgent(agent, withAgent.tenancy, true));

  // 8. Someone other than the landlord tries to approve the agent.
  await expectFail("Non-landlord approves an agent", "ConstraintHasOne", () =>
    ctx.program.methods.setAgentApproval(true)
      .accountsPartial({ landlord: t3.publicKey, tenancy: withAgent.tenancy, agentProfile: agentPda(agent.publicKey) })
      .signers([t3]).rpc());

  // Legit: landlord approves, then the agent releases.
  await ctx.program.methods.setAgentApproval(true)
    .accountsPartial({ landlord: l3.publicKey, tenancy: withAgent.tenancy, agentProfile: agentPda(agent.publicKey) })
    .signers([l3]).rpc();

  // 9. Suspended agent (approved by the landlord, but UltraRentz suspended them).
  await ctx.program.methods.setAgentActive(false)
    .accountsPartial({ admin: ctx.admin.publicKey, config: ctx.configPda, agentProfile: agentPda(agent.publicKey) }).rpc();
  await expectFail("Suspended agent tries to act", "AgentNotRegistered", () => asAgent(agent, withAgent.tenancy, true));

  // Re-activate: the approved agent can now act for the landlord.
  await ctx.program.methods.setAgentActive(true)
    .accountsPartial({ admin: ctx.admin.publicKey, config: ctx.configPda, agentProfile: agentPda(agent.publicKey) }).rpc();
  await asAgent(agent, withAgent.tenancy, true);
  console.log("   (approved, active agent released the deposit for the landlord ✓)");

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
