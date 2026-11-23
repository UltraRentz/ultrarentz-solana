/**
 * UltraRentz keeper bot — makes "automatic release" automatic.
 *
 * Scans every tenancy on-chain and calls the permissionless `settle` instruction as soon as one is due:
 *   • Active    → claim window closed with no landlord claim  → full refund + yield to tenant
 *   • Resolved  → landlord approved release / tenant accepted claim → pay out now
 *   • Claimed   → DAO voting period closed → lower-median award (or tenant wins if no quorum)
 *
 * Usage:
 *   npm run keeper            # loop forever (every 15s)
 *   npm run keeper -- --once  # single pass, e.g. from a cron job
 */
import {
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { Ctx, loadProgram, explorer, fmt, sleep } from "./common";

const INTERVAL_SECS = 15;

async function chainNow(ctx: Ctx): Promise<number> {
  const t = await ctx.conn.getBlockTime(await ctx.conn.getSlot());
  return t ?? Math.floor(Date.now() / 1000);
}

/** Returns why a tenancy can be settled now, or null if it isn't due yet. */
function dueReason(t: any, cfg: any, now: number): string | null {
  const end = Number(t.endTs);
  if (t.status.active) {
    if (end !== 0 && now >= end + Number(cfg.claimWindowSecs)) return "no claim in window → auto-refund";
    return null;
  }
  if (t.status.resolved) return "resolved by parties";
  if (t.status.claimed) {
    if (now >= Number(t.votingEndsTs)) return "DAO vote closed";
    return null;
  }
  return null;
}

export async function runOnce(ctx: Ctx): Promise<number> {
  const { program, conn, admin, configPda } = ctx;
  const cfg: any = await (program.account as any).config.fetch(configPda);
  const all: { publicKey: PublicKey; account: any }[] = await (program.account as any).tenancy.all();
  const now = await chainNow(ctx);
  let settled = 0;

  for (const { publicKey: tenancy, account: t } of all) {
    const reason = dueReason(t, cfg, now);
    if (!reason) continue;
    try {
      // Keeper pays to create any missing token accounts so a payout never gets stuck.
      const tenantAta = await getOrCreateAssociatedTokenAccount(conn, admin, t.mint, t.tenant);
      const landlordAta = await getOrCreateAssociatedTokenAccount(conn, admin, t.mint, t.landlord);
      const hasAgent = !t.agent.equals(PublicKey.default);
      const agentAta = hasAgent
        ? (await getOrCreateAssociatedTokenAccount(conn, admin, t.mint, t.agent)).address
        : null;
      const sig = await program.methods
        .settle()
        .accountsPartial({
          cranker: admin.publicKey,
          config: configPda,
          mint: t.mint,
          tenancy,
          vault: getAssociatedTokenAddressSync(t.mint, tenancy, true),
          tenant: t.tenant,
          landlord: t.landlord,
          tenantToken: tenantAta.address,
          landlordToken: landlordAta.address,
          agentToken: agentAta,
          treasury: cfg.treasury,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      settled++;
      console.log(
        `🤖 Keeper settled ${tenancy.toBase58().slice(0, 8)}… (${reason}, deposit ${fmt(t.principal)})\n   ${explorer(sig, conn)}`
      );
    } catch (e: any) {
      console.warn(`⚠️  Could not settle ${tenancy.toBase58().slice(0, 8)}…: ${e.message ?? e}`);
    }
  }
  return settled;
}

async function main() {
  const ctx = loadProgram();
  const once = process.argv.includes("--once");
  console.log(`🤖 UltraRentz keeper watching program ${ctx.program.programId.toBase58()}`);
  do {
    const n = await runOnce(ctx);
    if (once) {
      console.log(n ? `Settled ${n} tenancy(ies).` : "Nothing due.");
      break;
    }
    await sleep(INTERVAL_SECS);
  } while (true);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
