/** Shared helpers for UltraRentz scripts (demo scenarios + keeper bot). */
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import {
  Connection,
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
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

export const DECIMALS = 6;
export const UNIT = 10 ** DECIMALS;
export const FEE_BPS = 1_000; // 10% of yield
export const DEMO_WINDOW_SECS = 45; // production: 14 days claim window, 7 days voting

export const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
export const fmt = (n: number | bigint) => (Number(n) / UNIT).toFixed(2);

export function explorer(sig: string, conn: Connection) {
  const url = conn.rpcEndpoint;
  if (url.includes("devnet")) return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
  if (url.includes("127.0.0.1") || url.includes("localhost"))
    return `https://explorer.solana.com/tx/${sig}?cluster=custom`;
  return `https://explorer.solana.com/tx/${sig}`;
}

export function loadProgram() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const idlPath = path.join(__dirname, "..", "target", "idl", "ultrarentz.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  const program = new anchor.Program(idl, provider) as anchor.Program<any>;
  const admin = (provider.wallet as anchor.Wallet).payer;
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
  return { provider, program, conn: provider.connection, admin, configPda };
}

export type Ctx = ReturnType<typeof loadProgram>;

export const log = (ctx: Ctx, step: string, sig?: string) =>
  console.log(`\n✅ ${step}${sig ? `\n   ${explorer(sig, ctx.conn)}` : ""}`);

/** Ensure config exists with demo timings and a 3-juror panel. Returns the deposit mint. */
export async function ensureConfig(ctx: Ctx, jurors: PublicKey[]): Promise<PublicKey> {
  const { program, conn, admin, configPda } = ctx;
  let mint: PublicKey;
  if (await conn.getAccountInfo(configPda)) {
    const cfg: any = await (program.account as any).config.fetch(configPda);
    mint = cfg.mint;
    const sig = await program.methods
      .updateParams(FEE_BPS, new BN(DEMO_WINDOW_SECS), new BN(DEMO_WINDOW_SECS))
      .accountsPartial({ admin: admin.publicKey, config: configPda })
      .rpc();
    log(ctx, `Config ready (demo windows ${DEMO_WINDOW_SECS}s, fee 10% of yield)`, sig);
  } else {
    mint = await createMint(conn, admin, admin.publicKey, null, DECIMALS);
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
    log(ctx, `Initialised protocol config, test USDC mint ${mint.toBase58()}`, sig);
  }
  if (jurors.length) {
    const sig = await program.methods
      .setJurors(jurors, Math.min(2, jurors.length))
      .accountsPartial({ daoAuthority: admin.publicKey, config: configPda })
      .rpc();
    log(ctx, `DAO set ${jurors.length} jurors, quorum ${Math.min(2, jurors.length)}`, sig);
  }
  return mint;
}

/** Fund fresh keypairs with a little SOL from the admin wallet (avoids devnet airdrop limits). */
export async function fund(ctx: Ctx, kps: Keypair[], sol = 0.03) {
  const tx = new Transaction();
  for (const kp of kps)
    tx.add(
      SystemProgram.transfer({
        fromPubkey: ctx.admin.publicKey,
        toPubkey: kp.publicKey,
        lamports: Math.round(sol * LAMPORTS_PER_SOL),
      })
    );
  return sendAndConfirmTransaction(ctx.conn, tx, [ctx.admin]);
}

export function tenancyPda(programId: PublicKey, tenant: PublicKey, landlord: PublicKey, id: BN) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("tenancy"), tenant.toBuffer(), landlord.toBuffer(), id.toArrayLike(Buffer, "le", 8)],
    programId
  )[0];
}

/** Tenant locks `amount` tUSDC; tenancy ends `endsInSecs` from now. */
export async function createTenancy(
  ctx: Ctx,
  mint: PublicKey,
  tenant: Keypair,
  landlord: PublicKey,
  amount: number,
  endsInSecs: number
) {
  const { program, conn, admin, configPda } = ctx;
  const tenantAta = await getOrCreateAssociatedTokenAccount(conn, admin, mint, tenant.publicKey);
  await mintTo(conn, admin, mint, tenantAta.address, admin, amount);
  const id = new BN(Date.now());
  const tenancy = tenancyPda(program.programId, tenant.publicKey, landlord, id);
  const vault = getAssociatedTokenAddressSync(mint, tenancy, true);
  const endTs = Math.floor(Date.now() / 1000) + endsInSecs;
  const sig = await program.methods
    .createTenancy(id, new BN(amount), new BN(endTs))
    .accountsPartial({
      tenant: tenant.publicKey,
      landlord,
      config: configPda,
      mint,
      tenancy,
      vault,
      tenantToken: tenantAta.address,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([tenant])
    .rpc();
  return { tenancy, vault, endTs, tenantAta: tenantAta.address, sig };
}

/** Wait until the chain clock passes `ts` (local clock can drift from the cluster). */
export async function waitForChainTime(ctx: Ctx, ts: number) {
  for (;;) {
    const slot = await ctx.conn.getSlot();
    const now = await ctx.conn.getBlockTime(slot);
    if (now !== null && now >= ts) return;
    await sleep(2);
  }
}
