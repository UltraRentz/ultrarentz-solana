import { Program } from "@coral-xyz/anchor";
import { useState } from "react";
import { acceptClaim, releaseNow, serveNotice, submitEvidence } from "../lib/actions";
import {
  Config, Tenancy, fmt, fmtDate, fmtDuration, hasAgent, isZero, phaseOf, short, tenantYieldBps,
} from "../lib/program";

interface Props {
  t: Tenancy;
  cfg: Config;
  vaultBalance: number;
  now: number;
  program: Program;
  run: (label: string, fn: () => Promise<string>) => Promise<void>;
}

const Step = ({ done, active = false, label, sub }: { done: boolean; active?: boolean; label: string; sub?: string }) => (
  <div className="flex-1 min-w-0">
    <div className={`h-1.5 rounded-full ${done ? "bg-secondary" : active ? "bg-primary" : "bg-gray-200 dark:bg-gray-700"}`} />
    <p className={`mt-2 text-xs font-semibold ${done || active ? "text-gray-900 dark:text-white" : "text-gray-400"}`}>{label}</p>
    {sub && <p className="text-xs text-gray-500 truncate">{sub}</p>}
  </div>
);

export default function TenancyCard({ t, cfg, vaultBalance, now, program, run }: Props) {
  const phase = phaseOf(t, cfg, now);
  const [noticeDate, setNoticeDate] = useState("");
  const [evidence, setEvidence] = useState("");
  const [showEvidence, setShowEvidence] = useState(false);

  const shareBps = tenantYieldBps(t, cfg);
  const interestSoFar = Math.max(0, vaultBalance - t.principal);
  const myInterest = Math.floor((interestSoFar * shareBps) / 10_000);

  const ended = t.endTs !== 0 && now >= t.endTs;
  const reviewDone = phase.kind === "refundDue" || phase.kind === "resolved" || phase.kind === "decisionDue";

  const pill = {
    running: ["Locked & earning", "bg-blue-100 text-blue-700"],
    claimWindow: ["Landlord review period", "bg-yellow-100 text-yellow-800"],
    refundDue: ["Ready to pay you", "bg-green-100 text-green-700"],
    disputed: ["Claim raised", "bg-red-100 text-red-700"],
    decisionDue: ["Decision ready", "bg-green-100 text-green-700"],
    resolved: ["Agreed — ready to pay", "bg-green-100 text-green-700"],
  }[phase.kind];

  const releaseButton = (
    <button
      onClick={() => run("Releasing your deposit", () => releaseNow(program, cfg, t))}
      disabled={t.yieldActive}
      className="mt-4 w-full sm:w-auto px-6 py-3 rounded-xl bg-secondary text-white font-semibold hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      Release my deposit now
    </button>
  );

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-gray-500">Rent deposit</p>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">
            {fmt(t.principal)} <span className="text-base font-semibold text-gray-500">tUSDC</span>
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Landlord {short(t.landlord)}
            {hasAgent(t) && <> · Agent {short(t.agent)}</>}
          </p>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-semibold ${pill[1]}`}>{pill[0]}</span>
      </div>

      {/* Timeline */}
      <div className="flex gap-3 mt-6">
        <Step done label="Locked" sub={fmtDate(t.startTs)} />
        <Step done={ended} active={!ended} label="Tenancy ends" sub={t.endTs ? fmtDate(t.endTs) : "Rolling"} />
        <Step done={reviewDone} active={ended && !reviewDone} label="Review / decision" />
        <Step done={false} active={reviewDone} label="Paid to you" />
      </div>

      {/* What's happening now */}
      <div className="mt-6 rounded-xl bg-background dark:bg-gray-900 p-5">
        {phase.kind === "running" && phase.endsIn !== null && (
          <p className="text-gray-700 dark:text-gray-300">
            Your deposit is locked and earning. The tenancy ends in <b>{fmtDuration(phase.endsIn)}</b>.
          </p>
        )}
        {phase.kind === "running" && phase.endsIn === null && (
          <div>
            <p className="text-gray-700 dark:text-gray-300">
              Rolling tenancy. When you give notice, set your move-out date here.
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <input
                type="datetime-local"
                value={noticeDate}
                onChange={(e) => setNoticeDate(e.target.value)}
                className="px-3 py-2 rounded-lg border border-gray-300 dark:bg-gray-800 dark:border-gray-600"
              />
              <button
                disabled={!noticeDate}
                onClick={() =>
                  run("Serving notice", () => serveNotice(program, t, Math.floor(new Date(noticeDate).getTime() / 1000)))
                }
                className="px-4 py-2 rounded-lg bg-primary text-white font-semibold disabled:opacity-50"
              >
                Serve notice
              </button>
            </div>
          </div>
        )}
        {phase.kind === "claimWindow" && (
          <p className="text-gray-700 dark:text-gray-300">
            Your tenancy has ended. If your landlord doesn't raise a claim, your deposit comes back{" "}
            <b>automatically in {fmtDuration(phase.refundIn)}</b>.
          </p>
        )}
        {phase.kind === "refundDue" && (
          <div>
            <p className="text-gray-700 dark:text-gray-300">
              No claim was raised, so your full deposit is ready to be paid to you. Our keeper pays it
              automatically, or you can release it yourself right now.
            </p>
            {releaseButton}
          </div>
        )}
        {phase.kind === "disputed" && (
          <div>
            <p className="text-gray-700 dark:text-gray-300">
              Your landlord has claimed <b className="text-error">{fmt(t.claimAmount)} tUSDC</b>. Independent jurors
              are reviewing the evidence ({t.voteCount} vote{t.voteCount === 1 ? "" : "s"} so far, decision in{" "}
              <b>{fmtDuration(phase.votingEndsIn)}</b>).
            </p>
            <p className="text-xs text-gray-500 mt-2">
              Landlord's evidence fingerprint: <code>{Buffer.from(t.landlordEvidence).toString("hex").slice(0, 16)}…</code>
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-3">
              You don't have to reply. The landlord has to prove the claim, and staying silent never counts against
              you.
            </p>
            <div className="flex flex-wrap gap-2 mt-4">
              <button
                onClick={() => run("Accepting the claim", () => acceptClaim(program, t))}
                className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 font-semibold"
              >
                Accept claim
              </button>
              <button
                onClick={() => setShowEvidence((s) => !s)}
                className="px-4 py-2 rounded-lg bg-primary text-white font-semibold"
              >
                {isZero(t.tenantEvidence) ? "Add my evidence" : "Evidence submitted ✓ — update"}
              </button>
            </div>
            {showEvidence && (
              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                  placeholder="Link to your photos or check-in report"
                  className="flex-1 min-w-[240px] px-3 py-2 rounded-lg border border-gray-300 dark:bg-gray-800 dark:border-gray-600"
                />
                <button
                  disabled={!evidence}
                  onClick={() => run("Submitting your evidence", () => submitEvidence(program, t, evidence))}
                  className="px-4 py-2 rounded-lg bg-primary text-white font-semibold disabled:opacity-50"
                >
                  Submit
                </button>
              </div>
            )}
          </div>
        )}
        {(phase.kind === "decisionDue" || phase.kind === "resolved") && (
          <div>
            <p className="text-gray-700 dark:text-gray-300">
              {phase.kind === "resolved"
                ? t.landlordAward > 0
                  ? `Agreed: ${fmt(t.landlordAward)} tUSDC goes to your landlord; the rest comes back to you.`
                  : "Your landlord approved the full return of your deposit."
                : `Voting has closed (${t.voteCount} vote${t.voteCount === 1 ? "" : "s"}). The decision is ready to pay out.`}
            </p>
            {releaseButton}
          </div>
        )}
        {t.yieldActive && reviewDone && (
          <p className="text-xs text-gray-500 mt-2">
            Your deposit is in the lending market, so our keeper withdraws it and pays you in one step.
          </p>
        )}
      </div>

      {/* Interest */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent/40 bg-amber-50 dark:bg-amber-900/20 px-5 py-3">
        <p className="text-sm text-amber-900 dark:text-amber-200">
          <b>Your share of interest: {shareBps / 100}%</b>
          {!hasAgent(t) && <span className="opacity-75"> (includes the agent share — no agent on this tenancy)</span>}
        </p>
        <p className="text-sm font-semibold text-accent">
          {t.yieldActive
            ? "Earning in Jupiter Lend Earn"
            : interestSoFar > 0
            ? `+${fmt(myInterest)} tUSDC to you so far`
            : "Interest is paid out with your deposit"}
        </p>
      </div>
    </div>
  );
}
