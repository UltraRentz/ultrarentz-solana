/**
 * UltraRentz devnet demo — runs the full deposit lifecycle end to end.
 *
 *   lock deposit → (yield top-up) → tenancy ends → landlord claims with evidence
 *   → 3 DAO jurors vote → voting closes → settle (landlord award, protocol fee, tenant refund + yield)
 *
 * Usage (after `anchor build && anchor deploy --provider.cluster devnet`):
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   npx ts-node scripts/demo-devnet.ts
 *
 * Demo timings are short (claim window / voting period = 45s). Production values are 14d / 7d.
 */
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  mintTo,
  transfer,
  getAccount,
} from "@solana/spl-token";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

const DEMO_WINDOW_SECS = 45;
const DECIMALS = 6;
const UNIT = 10 ** DECIMALS;
const DEPOSIT = 1_200 * UNIT; // £1,200-equivalent test deposit
const YIELD_TOPUP = 36 * UNIT; // simulated yield earned during the tenancy
const CLAIM = 300 * UNIT; // landlord claims 300 for damage
const VOTES = [150, 200, 300].map((v) => v * UNIT); // juror awards → lower median = 200
const FEE_BPS = 1_000; // 10% of yield

const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
const fmt = (n: number | bigint) => (Number(n) / UNIT).toFixed(2);
const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const log = (step: string, sig?: string) =>
  console.log(`\n✅ ${step}${sig ? `\n   ${explorer(sig)}` : ""}`);

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const conn = provider.connection;
  const admin = (provider.wallet as anchor.Wallet).payer;

  const idlPath = path.join(__dirname, "..", "target", "idl", "ultrarentz.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  const program = new anchor.Program(idl, provider) as anchor.Program<any>;
  console.log(`Program: ${program.programId.toBase58()}`);
  console.log(`Admin:   ${admin.publicKey.toBase58()}`);

  // ---------- actors (fresh each run, funded from the admin wallet — no airdrop limits) ----------
  const tenant = Keypair.generate();
  const landlord = Keypair.generate();
  const jurors = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
  const fundTx = new Transaction();
  for (const kp of [tenant, landlord, ...jurors]) {
    fundTx.add(
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: kp.publicKey,
        lamports: 0.03 * LAMPORTS_PER_SOL,
      })
    );
  }
  log("Funded tenant, landlord and 3 jurors", await sendAndConfirmTransaction(conn, fundTx, [admin]));

  // ---------- config + test USDC (created once, reused on later runs) ----------
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
  let mint: PublicKey;
  const existing = await conn.getAccountInfo(configPda);
  if (existing) {
    const cfg: any = await (program.account as any).config.fetch(configPda);
    mint = cfg.mint;
    const sig = await program.methods
      .updateParams(FEE_BPS, new BN(DEMO_WINDOW_SECS), new BN(DEMO_WINDOW_SECS))
      .accountsPartial({ admin: admin.publicKey, config: configPda })
      .rpc();
    log(`Config exists — reset demo windows to ${DEMO_WINDOW_SECS}s`, sig);
  } else {
    mint = await createMint(conn, admin, admin.publicKey, null, DECIMALS);
    log(`Created test USDC mint ${mint.toBase58()}`);
    const treasury = await getOrCreateAssociatedTokenAccount(conn, admin, mint, admin.publicKey);
    const sig = await program.methods
      .initializeConfig(admin.publicKey, FEE_BPS, new BN(DEMO_WINDOW_SECS), new BN(DEMO_WINDOW_SECS))
      .accountsPartial({
        admin: admin.publicKey,
        config: configPda,
        mint,
        treasury: treasury.address,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    log("Initialised protocol config (fee = 10% of yield)", sig);
  }
  const treasury = getAssociatedTokenAddressSync(mint, admin.publicKey);

  const jurorSig = await program.methods
    .setJurors(jurors.map((j) => j.publicKey), 2)
    .accountsPartial({ daoAuthority: admin.publicKey, config: configPda })
    .rpc();
  log("DAO set 3 jurors, quorum 2", jurorSig);

  // ---------- token accounts ----------
  const tenantAta = await getOrCreateAssociatedTokenAccount(conn, admin, mint, tenant.publicKey);
  const landlordAta = await getOrCreateAssociatedTokenAccount(conn, admin, mint, landlord.publicKey);
  await mintTo(conn, admin, mint, tenantAta.address, admin, DEPOSIT);
  log(`Minted ${fmt(DEPOSIT)} tUSDC to tenant`);

  // ---------- 1. tenant locks deposit ----------
  const tenancyId = new BN(Date.now());
  const [tenancyPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("tenancy"),
      tenant.publicKey.toBuffer(),
      landlord.publicKey.toBuffer(),
      tenancyId.toArrayLike(Buffer, "le", 8),
    ],
    program.programId
  );
  const vault = getAssociatedTokenAddressSync(mint, tenancyPda, true);
  const endTs = Math.floor(Date.now() / 1000) + 20;

  const lockSig = await program.methods
    .createTenancy(tenancyId, new BN(DEPOSIT), new BN(endTs))
    .accountsPartial({
      tenant: tenant.publicKey,
      landlord: landlord.publicKey,
      config: configPda,
      mint,
      tenancy: tenancyPda,
      vault,
      tenantToken: tenantAta.address,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([tenant])
    .rpc();
  log(`1. Tenant locked ${fmt(DEPOSIT)} tUSDC in the escrow vault`, lockSig);

  // ---------- 2. yield accrues (simulated on devnet) ----------
  const adminAta = await getOrCreateAssociatedTokenAccount(conn, admin, mint, admin.publicKey);
  await mintTo(conn, admin, mint, adminAta.address, admin, YIELD_TOPUP);
  const ySig = await transfer(conn, admin, adminAta.address, vault, admin, YIELD_TOPUP);
  log(`2. Vault earned ${fmt(YIELD_TOPUP)} tUSDC yield (simulated)`, ySig);

  // ---------- 3. tenancy ends, landlord claims with evidence ----------
  console.log(`\n⏳ Waiting for tenancy end…`);
  await sleep(Math.max(0, endTs - Math.floor(Date.now() / 1000)) + 3);
  const evidence = "ipfs://demo/checkout-report-photos.zip";
  const evidenceHash = [...createHash("sha256").update(evidence).digest()];
  const claimSig = await program.methods
    .raiseClaim(new BN(CLAIM), evidenceHash, evidence)
    .accountsPartial({ landlord: landlord.publicKey, config: configPda, tenancy: tenancyPda })
    .signers([landlord])
    .rpc();
  log(`3. Landlord claimed ${fmt(CLAIM)} tUSDC for damage, with evidence hash`, claimSig);

  // ---------- 4. DAO jurors vote ----------
  for (let i = 0; i < jurors.length; i++) {
    const sig = await program.methods
      .castVote(new BN(VOTES[i]))
      .accountsPartial({ juror: jurors[i].publicKey, config: configPda, tenancy: tenancyPda })
      .signers([jurors[i]])
      .rpc();
    log(`4.${i + 1} Juror ${i + 1} voted to award ${fmt(VOTES[i])}`, sig);
  }

  // ---------- 5. voting closes, anyone settles ----------
  console.log(`\n⏳ Waiting for voting period to close (${DEMO_WINDOW_SECS}s)…`);
  await sleep(DEMO_WINDOW_SECS + 3);
  const settleSig = await program.methods
    .settle()
    .accountsPartial({
      cranker: admin.publicKey,
      config: configPda,
      mint,
      tenancy: tenancyPda,
      vault,
      tenant: tenant.publicKey,
      landlord: landlord.publicKey,
      tenantToken: tenantAta.address,
      landlordToken: landlordAta.address,
      treasury,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  log("5. Settled by permissionless crank", settleSig);

  const t = await getAccount(conn, tenantAta.address);
  const l = await getAccount(conn, landlordAta.address);
  console.log(`\n📊 Outcome`);
  console.log(`   Deposit ${fmt(DEPOSIT)} + yield ${fmt(YIELD_TOPUP)}`);
  console.log(`   Landlord (lower-median award): ${fmt(l.amount)}`);
  console.log(`   Tenant (refund + yield − fee): ${fmt(t.amount)}`);
  console.log(`   Protocol fee (10% of yield only): ${fmt(YIELD_TOPUP * FEE_BPS / 10_000)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
