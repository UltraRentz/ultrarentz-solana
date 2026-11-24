import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useMemo } from "react";
import idl from "../idl/ultrarentz.json";

export const RPC_URL: string = import.meta.env.VITE_RPC_URL ?? "http://127.0.0.1:8899";
export const CLUSTER_LABEL = RPC_URL.includes("devnet") ? "Devnet" : RPC_URL.includes("127.0.0.1") || RPC_URL.includes("localhost") ? "Local validator" : "Mainnet";
export const PROGRAM_ID = new PublicKey((idl as { address: string }).address);
export const DECIMALS = 6;
export const UNIT = 10 ** DECIMALS;
export const [CONFIG_PDA] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);

export function useProgram(): Program | null {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  return useMemo(() => {
    if (!wallet) return null;
    const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
    return new Program(idl as any, provider);
  }, [connection, wallet]);
}

export type Status = "active" | "claimed" | "resolved";

export interface Tenancy {
  address: PublicKey;
  tenant: PublicKey;
  landlord: PublicKey;
  agent: PublicKey;
  mint: PublicKey;
  tenancyId: BN;
  principal: number;
  startTs: number;
  endTs: number;
  status: Status;
  claimAmount: number;
  landlordEvidence: number[];
  tenantEvidence: number[];
  votingEndsTs: number;
  voteCount: number;
  landlordAward: number;
  yieldActive: boolean;
}

export interface Config {
  mint: PublicKey;
  treasury: PublicKey;
  claimWindowSecs: number;
  votingPeriodSecs: number;
  quorum: number;
  yieldSplit: { tenantBps: number; landlordBps: number; agentBps: number; protocolBps: number };
}

export const hasAgent = (t: Tenancy) => !t.agent.equals(PublicKey.default);
export const isZero = (b: number[]) => b.every((x) => x === 0);

export function toTenancy(address: PublicKey, a: any): Tenancy {
  return {
    address,
    tenant: a.tenant,
    landlord: a.landlord,
    agent: a.agent,
    mint: a.mint,
    tenancyId: a.tenancyId,
    principal: Number(a.principal),
    startTs: Number(a.startTs),
    endTs: Number(a.endTs),
    status: Object.keys(a.status)[0] as Status,
    claimAmount: Number(a.claimAmount),
    landlordEvidence: a.landlordEvidence,
    tenantEvidence: a.tenantEvidence,
    votingEndsTs: Number(a.votingEndsTs),
    voteCount: a.voteCount,
    landlordAward: Number(a.landlordAward),
    yieldActive: a.yieldActive,
  };
}

export function toConfig(a: any): Config {
  return {
    mint: a.mint,
    treasury: a.treasury,
    claimWindowSecs: Number(a.claimWindowSecs),
    votingPeriodSecs: Number(a.votingPeriodSecs),
    quorum: a.quorum,
    yieldSplit: a.yieldSplit,
  };
}

/** Fetch every tenancy where this wallet is the tenant (tenant is the first field after the 8-byte discriminator). */
export async function fetchMyTenancies(program: Program, tenant: PublicKey): Promise<Tenancy[]> {
  const rows = await (program.account as any).tenancy.all([{ memcmp: { offset: 8, bytes: tenant.toBase58() } }]);
  return rows
    .map((r: any) => toTenancy(r.publicKey, r.account))
    .sort((a: Tenancy, b: Tenancy) => b.startTs - a.startTs);
}

export const fmt = (n: number) =>
  (n / UNIT).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const short = (k: PublicKey) => `${k.toBase58().slice(0, 4)}…${k.toBase58().slice(-4)}`;

export function fmtDuration(secs: number): string {
  if (secs <= 0) return "now";
  const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export const fmtDate = (ts: number) =>
  new Date(ts * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export async function sha256(text: string): Promise<number[]> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)];
}

/** Where a tenancy is in its life, from the tenant's point of view. */
export type Phase =
  | { kind: "running"; endsIn: number | null }
  | { kind: "claimWindow"; refundIn: number }
  | { kind: "refundDue" }
  | { kind: "disputed"; votingEndsIn: number }
  | { kind: "decisionDue" }
  | { kind: "resolved" };

export function phaseOf(t: Tenancy, cfg: Config, now: number): Phase {
  if (t.status === "resolved") return { kind: "resolved" };
  if (t.status === "claimed") {
    return now >= t.votingEndsTs ? { kind: "decisionDue" } : { kind: "disputed", votingEndsIn: t.votingEndsTs - now };
  }
  if (t.endTs === 0) return { kind: "running", endsIn: null };
  if (now < t.endTs) return { kind: "running", endsIn: t.endTs - now };
  const refundAt = t.endTs + cfg.claimWindowSecs;
  return now >= refundAt ? { kind: "refundDue" } : { kind: "claimWindow", refundIn: refundAt - now };
}

/** The tenant's share of interest, in basis points (agent's share goes to the tenant when there is no agent). */
export const tenantYieldBps = (t: Tenancy, cfg: Config) =>
  cfg.yieldSplit.tenantBps + (hasAgent(t) ? 0 : cfg.yieldSplit.agentBps);
