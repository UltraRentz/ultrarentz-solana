import { BN, Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { CONFIG_PDA, Config, Tenancy, hasAgent, sha256 } from "./program";

const me = (p: Program) => p.provider.publicKey!;

export async function payDeposit(
  program: Program,
  cfg: Config,
  landlord: PublicKey,
  amount: number,
  endTs: number,
  agent: PublicKey | null
) {
  const tenant = me(program);
  const id = new BN(Date.now());
  const [tenancy] = PublicKey.findProgramAddressSync(
    [Buffer.from("tenancy"), tenant.toBuffer(), landlord.toBuffer(), id.toArrayLike(Buffer, "le", 8)],
    program.programId
  );
  return program.methods
    .createTenancy(id, new BN(amount), new BN(endTs), agent)
    .accountsPartial({
      tenant,
      landlord,
      config: CONFIG_PDA,
      mint: cfg.mint,
      tenancy,
      vault: getAssociatedTokenAddressSync(cfg.mint, tenancy, true),
      tenantToken: getAssociatedTokenAddressSync(cfg.mint, tenant),
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export const serveNotice = (program: Program, t: Tenancy, endTs: number) =>
  program.methods.serveNotice(new BN(endTs)).accountsPartial({ signer: me(program), tenancy: t.address }).rpc();

export const acceptClaim = (program: Program, t: Tenancy) =>
  program.methods.acceptClaim().accountsPartial({ tenant: me(program), tenancy: t.address }).rpc();

export async function submitEvidence(program: Program, t: Tenancy, text: string) {
  const uri = text.slice(0, 200);
  return program.methods
    .submitTenantEvidence(await sha256(text), uri)
    .accountsPartial({ tenant: me(program), tenancy: t.address })
    .rpc();
}

/** The tenant triggers their own payout once it's due — no landlord or keeper needed. */
export async function releaseNow(program: Program, cfg: Config, t: Tenancy) {
  const payer = me(program);
  const ata = (owner: PublicKey) => getAssociatedTokenAddressSync(t.mint, owner, true);
  const pre = [
    createAssociatedTokenAccountIdempotentInstruction(payer, ata(t.tenant), t.tenant, t.mint),
    createAssociatedTokenAccountIdempotentInstruction(payer, ata(t.landlord), t.landlord, t.mint),
  ];
  if (hasAgent(t)) pre.push(createAssociatedTokenAccountIdempotentInstruction(payer, ata(t.agent), t.agent, t.mint));
  return program.methods
    .settle()
    .accountsPartial({
      cranker: payer,
      config: CONFIG_PDA,
      mint: t.mint,
      tenancy: t.address,
      vault: ata(t.address),
      tenant: t.tenant,
      landlord: t.landlord,
      tenantToken: ata(t.tenant),
      landlordToken: ata(t.landlord),
      agentToken: (hasAgent(t) ? ata(t.agent) : null) as any,
      treasury: cfg.treasury,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions(pre)
    .rpc();
}

// ---------------------------------------------------------------- landlord actions

export const approveRelease = (program: Program, t: Tenancy) =>
  program.methods
    .approveRelease()
    .accountsPartial({ landlord: me(program), config: CONFIG_PDA, tenancy: t.address })
    .rpc();

export async function raiseClaim(program: Program, t: Tenancy, amount: number, evidence: string) {
  return program.methods
    .raiseClaim(new BN(amount), await sha256(evidence), evidence.slice(0, 200))
    .accountsPartial({ landlord: me(program), config: CONFIG_PDA, tenancy: t.address })
    .rpc();
}
