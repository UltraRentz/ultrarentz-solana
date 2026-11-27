import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useState } from "react";
import { approveRelease, raiseClaim, releaseNow, serveNotice, setAgentApproval } from "../lib/actions";
import {
  AgentProfile, Config, Tenancy, UNIT, fetchAgentProfile, fetchManagedTenancies, fmt, fmtDate, fmtDuration, hasAgent, phaseOf, short,
} from "../lib/program";
import StatCard from "./StatCard";

interface Props {
  program: Program;
  me: PublicKey;
  cfg: Config;
  now: number;
  run: (label: string, fn: () => Promise<string>) => Promise<void>;
  refreshKey: number;
}

function LandlordCard({ t, role, cfg, now, program, run, agentProfile }: { t: Tenancy; role: "landlord" | "agent"; cfg: Config; now: number; program: Program; run: Props["run"]; agentProfile: AgentProfile | null | undefined }) {
  const phase = phaseOf(t, cfg, now);
  const [showClaim, setShowClaim] = useState(false);
  const [amount, setAmount] = useState("");
  const [evidence, setEvidence] = useState("");
  const [noticeDate, setNoticeDate] = useState("");
  const isLandlord = role === "landlord";
  // Who may act: the landlord, or the agent once the landlord approved them and UltraRentz has them active.
  const canAct = isLandlord || (t.agentApproved && !!agentProfile?.active);
  const units = Math.round(Number(amount) * UNIT);
  const claimValid = units > 0 && units <= t.principal && evidence.trim().length > 0;

  const pill = {
    running: ["Tenancy running", "bg-blue-100 text-blue-700"],
    claimWindow: ["Check-out review", "bg-yellow-100 text-yellow-800"],
    refundDue: ["Refund due to tenant", "bg-gray-100 text-gray-700"],
    disputed: ["Claim with jurors", "bg-red-100 text-red-700"],
    decisionDue: ["Decision ready", "bg-green-100 text-green-700"],
    resolved: ["Resolved — ready to pay", "bg-green-100 text-green-700"],
  }[phase.kind];

  const agentNote = !isLandlord && !canAct && (
    <p className="text-xs text-gray-500 mt-3">
      {!agentProfile
        ? "You're named as the letting agent, but you aren't registered with UltraRentz yet, so the landlord handles this tenancy."
        : !agentProfile.active
        ? "Your agent account is suspended by UltraRentz."
        : "Waiting for the landlord to approve you to act for them on this tenancy."}
    </p>
  );

  const agentPanel = hasAgent(t) && (
    <div className="mt-4 rounded-xl border border-gray-200 dark:border-gray-700 px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-sm">
      <div>
        <span className="font-semibold text-gray-900 dark:text-white">
          Letting agent: {agentProfile ? agentProfile.name : short(t.agent)}
        </span>{" "}
        {t.agentApproved ? (
          <span className="ml-2 px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold">Can act for the landlord</span>
        ) : (
          <span className="ml-2 px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-semibold">Not approved</span>
        )}
        {agentProfile === null && <span className="ml-2 text-gray-500">(not registered with UltraRentz)</span>}
        {agentProfile && !agentProfile.active && <span className="ml-2 text-error">(suspended)</span>}
      </div>
      {isLandlord && agentProfile?.active && (
        t.agentApproved ? (
          <button onClick={() => run("Revoking your agent", () => setAgentApproval(program, t, false))} className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 font-semibold">
            Revoke
          </button>
        ) : (
          <button onClick={() => run("Approving your agent", () => setAgentApproval(program, t, true))} className="px-3 py-1.5 rounded-lg bg-primary text-white font-semibold">
            Let this agent act for me
          </button>
        )
      )}
    </div>
  );

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-gray-500">Deposit held for you · {isLandlord ? "you are the landlord" : t.agentApproved ? "you are the agent, acting for the landlord" : "you are the agent"}</p>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">
            {fmt(t.principal)} <span className="text-base font-semibold text-gray-500">tUSDC</span>
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Tenant {short(t.tenant)} · {t.endTs ? `ends ${fmtDate(t.endTs)}` : "rolling tenancy"}
          </p>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-semibold ${pill[1]}`}>{pill[0]}</span>
      </div>

      <div className="mt-6 rounded-xl bg-background dark:bg-gray-900 p-5">
        {phase.kind === "running" && phase.endsIn !== null && (
          <p className="text-gray-700 dark:text-gray-300">
            The deposit is locked and earning. Tenancy ends in <b>{fmtDuration(phase.endsIn)}</b>. After that you'll have{" "}
            {fmtDuration(cfg.claimWindowSecs)} to approve the release or raise a claim.
          </p>
        )}
        {phase.kind === "running" && phase.endsIn === null && (
          <div>
            <p className="text-gray-700 dark:text-gray-300">Rolling tenancy. Set the end date when notice is given.</p>
            {isLandlord && (
              <div className="flex flex-wrap gap-2 mt-3">
                <input type="datetime-local" value={noticeDate} onChange={(e) => setNoticeDate(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-300 dark:bg-gray-800 dark:border-gray-600" />
                <button disabled={!noticeDate} onClick={() => run("Serving notice", () => serveNotice(program, t, Math.floor(new Date(noticeDate).getTime() / 1000)))} className="px-4 py-2 rounded-lg bg-primary text-white font-semibold disabled:opacity-50">Serve notice</button>
              </div>
            )}
          </div>
        )}
        {phase.kind === "claimWindow" && (
          <div>
            <p className="text-gray-700 dark:text-gray-300">
              The tenancy has ended. You have <b>{fmtDuration(phase.refundIn)}</b> to check the property. If you do
              nothing, the full deposit goes back to the tenant automatically.
            </p>
            {canAct && (
              <>
                <div className="flex flex-wrap gap-2 mt-4">
                  <button onClick={() => run("Approving full release", () => approveRelease(program, t))} className="px-5 py-2.5 rounded-xl bg-secondary text-white font-semibold hover:bg-emerald-600">
                    All good — release in full
                  </button>
                  <button onClick={() => setShowClaim((s) => !s)} className="px-5 py-2.5 rounded-xl border border-error text-error font-semibold">
                    Raise a claim
                  </button>
                </div>
                {showClaim && (
                  <div className="mt-4 space-y-3">
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Independent jurors decide. <b>You must provide evidence</b> (check-out report, photos, invoices).
                      Without enough votes, the deposit goes back to the tenant.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <input type="number" min="0" max={t.principal / UNIT} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`Amount (max ${fmt(t.principal)})`} className="w-48 px-3 py-2 rounded-lg border border-gray-300 dark:bg-gray-800 dark:border-gray-600" />
                      <input value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Link to your evidence" className="flex-1 min-w-[220px] px-3 py-2 rounded-lg border border-gray-300 dark:bg-gray-800 dark:border-gray-600" />
                    </div>
                    <button disabled={!claimValid} onClick={() => run("Raising your claim", () => raiseClaim(program, t, units, evidence.trim()))} className="px-5 py-2.5 rounded-xl bg-error text-white font-semibold disabled:opacity-50">
                      Submit claim to jurors
                    </button>
                  </div>
                )}
              </>
            )}
            {agentNote}
          </div>
        )}
        {phase.kind === "refundDue" && (
          <p className="text-gray-700 dark:text-gray-300">No claim was raised in time, so the full deposit is being returned to the tenant.</p>
        )}
        {phase.kind === "disputed" && (
          <p className="text-gray-700 dark:text-gray-300">
            Your claim of <b>{fmt(t.claimAmount)} tUSDC</b> is with the jurors ({t.voteCount} vote{t.voteCount === 1 ? "" : "s"} so far). Decision in{" "}
            <b>{fmtDuration(phase.votingEndsIn)}</b>. You'll receive the middle juror award (or nothing without enough votes).
          </p>
        )}
        {(phase.kind === "decisionDue" || phase.kind === "resolved") && (
          <div>
            <p className="text-gray-700 dark:text-gray-300">
              {phase.kind === "resolved"
                ? t.landlordAward > 0 ? `Agreed: ${fmt(t.landlordAward)} tUSDC comes to you.` : "You approved the full release."
                : "Voting has closed. The decision is ready to be paid out."}
            </p>
            <button onClick={() => run("Paying out", () => releaseNow(program, cfg, t))} disabled={t.yieldActive} className="mt-4 px-5 py-2.5 rounded-xl bg-secondary text-white font-semibold disabled:opacity-50">
              Pay out now
            </button>
          </div>
        )}
      </div>

      {agentPanel}

      <div className="mt-4 rounded-xl border border-accent/40 bg-amber-50 dark:bg-amber-900/20 px-5 py-3 text-sm text-amber-900 dark:text-amber-200">
        <b>Your share of the interest: {isLandlord ? cfg.yieldSplit.landlordBps / 100 : cfg.yieldSplit.agentBps / 100}%</b>, paid when the deposit is settled.
      </div>
    </div>
  );
}

export default function LandlordView({ program, me, cfg, now, run, refreshKey }: Props) {
  const [rows, setRows] = useState<{ t: Tenancy; role: "landlord" | "agent" }[]>([]);
  const [copied, setCopied] = useState(false);
  const [profiles, setProfiles] = useState<Record<string, AgentProfile | null>>({});

  const load = useCallback(async () => {
    try {
      const r = await fetchManagedTenancies(program, me);
      setRows(r);
      const agents = [...new Set([me.toBase58(), ...r.filter((x) => hasAgent(x.t)).map((x) => x.t.agent.toBase58())])];
      const entries = await Promise.all(agents.map(async (k) => [k, await fetchAgentProfile(program, new PublicKey(k))] as const));
      setProfiles(Object.fromEntries(entries));
    } catch { /* keep last */ }
  }, [program, me]);
  const myProfile = profiles[me.toBase58()];
  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load, refreshKey]);

  const held = rows.reduce((s, r) => s + r.t.principal, 0);
  const actionNeeded = rows.filter((r) => r.role === "landlord" && phaseOf(r.t, cfg, now).kind === "claimWindow").length;
  const disputes = rows.filter((r) => r.t.status === "claimed").length;

  const copy = async () => {
    try { await navigator.clipboard.writeText(me.toBase58()); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <StatCard title="Deposits held for you" value={fmt(held)} subtitle={`${rows.length} ${rows.length === 1 ? "tenancy" : "tenancies"} · tUSDC`} color="blue" icon="🏠" />
        <StatCard title="Needs your review" value={actionNeeded} subtitle="Check-outs waiting for you" color="orange" icon="🔍" />
        <StatCard title="Open claims" value={disputes} subtitle="With independent jurors" color="red" icon="⚖️" />
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-5 mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-gray-900 dark:text-white">Your landlord / agent address</p>
          <p className="text-sm text-gray-500 break-all">{me.toBase58()}</p>
          <p className="text-xs text-gray-400 mt-1">Give this to your tenant. They enter it when paying their deposit.</p>
          {myProfile && (
            <p className="text-sm mt-2">
              <span className={`px-2 py-0.5 rounded-full font-semibold ${myProfile.active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                {myProfile.active ? `✓ Registered agent: ${myProfile.name}` : `Agent account suspended: ${myProfile.name}`}
              </span>
            </p>
          )}
        </div>
        <button onClick={copy} className="px-4 py-2 rounded-lg bg-primary text-white font-semibold">{copied ? "Copied ✓" : "Copy"}</button>
      </div>

      <div className="space-y-6">
        {rows.length === 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 text-center text-gray-500">
            No tenancies yet. Share your address with a tenant: their deposit appears here as soon as they pay it.
          </div>
        )}
        {rows.map((r) => (
          <LandlordCard key={r.t.address.toBase58() + r.role} t={r.t} role={r.role} cfg={cfg} now={now} program={program} run={run} agentProfile={profiles[r.t.agent.toBase58()]} />
        ))}
      </div>
    </>
  );
}
