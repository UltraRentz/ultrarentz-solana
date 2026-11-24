import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { useState } from "react";
import { payDeposit } from "../lib/actions";
import { Config, UNIT, fmt, fmtDuration } from "../lib/program";

interface Props {
  program: Program;
  cfg: Config;
  balance: number;
  run: (label: string, fn: () => Promise<string>) => Promise<void>;
}

const parseKey = (s: string): PublicKey | null => {
  try { return s.trim() ? new PublicKey(s.trim()) : null; } catch { return null; }
};

export default function PayDepositForm({ program, cfg, balance, run }: Props) {
  const [landlord, setLandlord] = useState("");
  const [agent, setAgent] = useState("");
  const [amount, setAmount] = useState("1200");
  const [mode, setMode] = useState<"date" | "rolling" | "demo">("demo");
  const [endDate, setEndDate] = useState("");
  const [demoMins, setDemoMins] = useState("1");

  const landlordKey = parseKey(landlord);
  const agentKey = agent.trim() ? parseKey(agent) : null;
  const units = Math.round(Number(amount) * UNIT);
  const endTs =
    mode === "rolling" ? 0
    : mode === "demo" ? Math.floor(Date.now() / 1000) + Math.round(Number(demoMins) * 60)
    : endDate ? Math.floor(new Date(endDate).getTime() / 1000) : -1;

  const errors = [
    !landlordKey && "Enter your landlord's wallet address",
    agent.trim() && !agentKey && "Agent address isn't valid",
    !(units > 0) && "Enter a deposit amount",
    units > balance && `You have ${fmt(balance)} tUSDC`,
    endTs === -1 && "Choose an end date",
  ].filter(Boolean) as string[];

  const field = "w-full px-3 py-2 rounded-lg border border-gray-300 dark:bg-gray-900 dark:border-gray-600";

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
      <h2 className="text-xl font-bold text-gray-900 dark:text-white">Pay a deposit</h2>
      <p className="text-sm text-gray-500 mt-1">
        It's locked for you, earns interest, and comes back automatically when you move out.
      </p>

      <div className="mt-5 space-y-4">
        <label className="block">
          <span className="text-sm font-semibold">Landlord's wallet</span>
          <input className={field} value={landlord} onChange={(e) => setLandlord(e.target.value)} placeholder="Address" />
        </label>
        <label className="block">
          <span className="text-sm font-semibold">Letting agent's wallet <span className="font-normal text-gray-500">(optional)</span></span>
          <input className={field} value={agent} onChange={(e) => setAgent(e.target.value)} placeholder="Leave blank if no agent" />
        </label>
        <label className="block">
          <span className="text-sm font-semibold">Deposit (tUSDC)</span>
          <input className={field} type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <span className="text-xs text-gray-500">Your balance: {fmt(balance)} tUSDC</span>
        </label>
        <div>
          <span className="text-sm font-semibold">Tenancy end</span>
          <div className="flex gap-2 mt-1">
            {(["demo", "date", "rolling"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border ${
                  mode === m ? "bg-primary text-white border-primary" : "border-gray-300 dark:border-gray-600"
                }`}
              >
                {m === "demo" ? "Demo" : m === "date" ? "Fixed date" : "Rolling"}
              </button>
            ))}
          </div>
          {mode === "date" && (
            <input className={`${field} mt-2`} type="datetime-local" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          )}
          {mode === "demo" && (
            <div className="flex items-center gap-2 mt-2 text-sm">
              Ends in
              <input className="w-20 px-2 py-1 rounded-lg border border-gray-300 dark:bg-gray-900 dark:border-gray-600" type="number" min="0.5" step="0.5" value={demoMins} onChange={(e) => setDemoMins(e.target.value)} />
              minutes
            </div>
          )}
          {mode === "rolling" && <p className="text-xs text-gray-500 mt-2">You'll set the end date when notice is given.</p>}
        </div>
      </div>

      <button
        disabled={errors.length > 0}
        onClick={() => run("Locking your deposit", () => payDeposit(program, cfg, landlordKey!, units, endTs, agentKey))}
        className="mt-6 w-full px-6 py-3 rounded-xl bg-primary text-white font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Lock my deposit
      </button>
      {errors.length > 0 && <p className="text-xs text-gray-500 mt-2">{errors[0]}</p>}
      <p className="text-xs text-gray-400 mt-3">
        After move-out your landlord has {fmtDuration(cfg.claimWindowSecs)} to raise a claim; otherwise it's paid back
        automatically.
      </p>
    </div>
  );
}
