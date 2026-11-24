/**
 * Local helpers for the web app.
 *
 *   npm run local -- setup                 # create config, test USDC, 3 jurors; print landlord address
 *   npm run local -- fund <wallet>         # send 1 SOL + 5,000 tUSDC to a wallet (e.g. your Phantom or demo wallet)
 *   npm run local -- claim <tenancy> <amt> # act as the demo landlord: raise a claim with evidence
 *   npm run local -- approve <tenancy>     # act as the demo landlord: approve full release
 *   npm run local -- vote <tenancy> <a,b,c># the 3 demo jurors vote these amounts
 */
import { BN } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { loadProgram, ensureConfig, fund, UNIT } from "./common";

const DIR = path.join(__dirname, "..", ".demo");
function keypair(name: string): Keypair {
  const file = path.join(DIR, `${name}.json`);
  if (fs.existsSync(file)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
  const kp = Keypair.generate();
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify([...kp.secretKey]));
  return kp;
}

async function main() {
  const [cmd, a1, a2] = process.argv.slice(2);
  const ctx = loadProgram();
  const landlord = keypair("landlord");
  const agent = keypair("agent");
  const jurors = [keypair("juror1"), keypair("juror2"), keypair("juror3")];

  if (cmd === "setup") {
    await fund(ctx, [landlord, ...jurors], 0.2);
    const mint = await ensureConfig(ctx, jurors.map((j) => j.publicKey));
    console.log(`\nTest USDC mint: ${mint.toBase58()}`);
    console.log(`Demo landlord:  ${landlord.publicKey.toBase58()}   ← paste into "Landlord's wallet"`);
    console.log(`Demo agent:     ${agent.publicKey.toBase58()}   ← optional "Letting agent's wallet"`);
    return;
  }

  const cfg: any = await (ctx.program.account as any).config.fetch(ctx.configPda);
  if (cmd === "fund") {
    const to = new PublicKey(a1);
    await sendAndConfirmTransaction(ctx.conn, new Transaction().add(
      SystemProgram.transfer({ fromPubkey: ctx.admin.publicKey, toPubkey: to, lamports: LAMPORTS_PER_SOL })), [ctx.admin]);
    const ata = await getOrCreateAssociatedTokenAccount(ctx.conn, ctx.admin, cfg.mint, to);
    await mintTo(ctx.conn, ctx.admin, cfg.mint, ata.address, ctx.admin, 5_000 * UNIT);
    console.log(`Sent 1 SOL + 5,000 tUSDC to ${to.toBase58()}`);
  } else if (cmd === "claim") {
    const evidence = "ipfs://demo/checkout-report-photos.zip";
    await ctx.program.methods
      .raiseClaim(new BN(Math.round(Number(a2 ?? "200") * UNIT)), [...createHash("sha256").update(evidence).digest()], evidence)
      .accountsPartial({ landlord: landlord.publicKey, config: ctx.configPda, tenancy: new PublicKey(a1) })
      .signers([landlord]).rpc();
    console.log(`Landlord claimed ${a2 ?? "200"} tUSDC on ${a1}`);
  } else if (cmd === "approve") {
    await ctx.program.methods.approveRelease()
      .accountsPartial({ landlord: landlord.publicKey, config: ctx.configPda, tenancy: new PublicKey(a1) })
      .signers([landlord]).rpc();
    console.log(`Landlord approved full release on ${a1}`);
  } else if (cmd === "vote") {
    const amounts = (a2 ?? "100,150,200").split(",").map(Number);
    for (let i = 0; i < amounts.length; i++) {
      await ctx.program.methods.castVote(new BN(Math.round(amounts[i] * UNIT)))
        .accountsPartial({ juror: jurors[i].publicKey, config: ctx.configPda, tenancy: new PublicKey(a1) })
        .signers([jurors[i]]).rpc();
      console.log(`Juror ${i + 1} voted ${amounts[i]}`);
    }
  } else {
    console.log("Usage: npm run local -- setup | fund <wallet> | claim <tenancy> <amount> | approve <tenancy> | vote <tenancy> <a,b,c>");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
