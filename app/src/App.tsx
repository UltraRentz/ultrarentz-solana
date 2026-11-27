import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { useCallback, useEffect, useRef, useState } from "react";
import PayDepositForm from "./components/PayDepositForm";
import StatCard from "./components/StatCard";
import TenancyCard from "./components/TenancyCard";
import LandlordView from "./components/LandlordView";
import {
  CLUSTER_LABEL, CONFIG_PDA, Config, Tenancy, fetchMyTenancies, fmt, fmtDuration, phaseOf, tenantYieldBps, toConfig, useProgram,
} from "./lib/program";

type Toast = { kind: "busy" | "ok" | "err"; text: string; sig?: string } | null;

export default function App() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const program = useProgram();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [tenancies, setTenancies] = useState<Tenancy[]>([]);
  const [vaults, setVaults] = useState<Record<string, number>>({});
  const [balance, setBalance] = useState(0);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const [toast, setToast] = useState<Toast>(null);
  const [dark, setDark] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<"tenant" | "landlord">(() => (location.hash === "#landlord" ? "landlord" : "tenant"));
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => { history.replaceState(null, "", tab === "landlord" ? "#landlord" : "#tenant"); }, [tab]);
  const [paid, setPaid] = useState<{ id: string; principal: number; at: number }[]>([]);
  const seen = useRef<Map<string, Tenancy>>(new Map());

  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    if (!program || !publicKey) return;
    try {
      const c = toConfig(await (program.account as any).config.fetch(CONFIG_PDA));
      setCfg(c);
      const ts = await fetchMyTenancies(program, publicKey);
      // A tenancy that disappears has been settled and closed on-chain: show a receipt.
      const ids = new Set(ts.map((t) => t.address.toBase58()));
      const gone = [...seen.current.values()].filter((t) => !ids.has(t.address.toBase58()));
      if (gone.length) setPaid((p) => [...gone.map((t) => ({ id: t.address.toBase58(), principal: t.principal, at: Date.now() })), ...p]);
      seen.current = new Map(ts.map((t) => [t.address.toBase58(), t]));
      setTenancies(ts);
      const v: Record<string, number> = {};
      await Promise.all(
        ts.map(async (t) => {
          try {
            v[t.address.toBase58()] = Number((await getAccount(connection, getAssociatedTokenAddressSync(t.mint, t.address, true))).amount);
          } catch { v[t.address.toBase58()] = 0; }
        })
      );
      setVaults(v);
      try {
        setBalance(Number((await getAccount(connection, getAssociatedTokenAddressSync(c.mint, publicKey))).amount));
      } catch { setBalance(0); }
      setLoadError(null);
    } catch (e: any) {
      setLoadError(`Can't reach UltraRentz on ${CLUSTER_LABEL}. Is the validator running and the protocol set up? (${e.message ?? e})`);
    }
  }, [program, publicKey, connection]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const run = async (label: string, fn: () => Promise<string>) => {
    setToast({ kind: "busy", text: `${label}…` });
    try {
      const sig = await fn();
      setToast({ kind: "ok", text: `${label}: done`, sig });
      setTimeout(() => setToast((t) => (t?.sig === sig ? null : t)), 6000);
      setRefreshKey((k) => k + 1);
      await refresh();
    } catch (e: any) {
      const logs: string[] = e?.logs ?? [];
      const reason = logs.find((l) => l.includes("Error Message"))?.split("Error Message: ")[1] ?? e.message ?? String(e);
      setToast({ kind: "err", text: `${label} failed: ${reason}` });
    }
  };

  const active = tenancies;
  if (import.meta.env.DEV) { (window as any).__wallet = publicKey?.toBase58(); (window as any).__tenancies = tenancies.map((t) => t.address.toBase58()); }
  const lockedTotal = active.reduce((s, t) => s + t.principal, 0);
  const next = cfg
    ? active
        .map((t) => phaseOf(t, cfg, now))
        .map((p) => (p.kind === "claimWindow" ? p.refundIn : p.kind === "disputed" ? p.votingEndsIn : p.kind === "refundDue" || p.kind === "resolved" || p.kind === "decisionDue" ? 0 : null))
        .filter((x): x is number => x !== null)
        .sort((a, b) => a - b)[0]
    : undefined;
  const share = cfg && active[0] ? tenantYieldBps(active[0], cfg) / 100 : cfg ? cfg.yieldSplit.tenantBps / 100 : 60;

  return (
    <div className="min-h-screen dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white/80 dark:bg-gray-800/80 backdrop-blur shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <span className="text-2xl font-bold text-indigo-600 dark:text-indigo-300">UltraRentz</span>
            <nav className="hidden sm:flex gap-1">
              {(["tenant", "landlord"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${tab === k ? "bg-primary/10 text-primary" : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"}`}
                >
                  {k === "tenant" ? "I'm a tenant" : "Landlord / Agent"}
                </button>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden md:inline text-xs font-semibold px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
              Solana · {CLUSTER_LABEL}
            </span>
            <button onClick={() => setDark((d) => !d)} className="text-xl" title="Toggle theme">{dark ? "☀️" : "🌙"}</button>
            <WalletMultiButton />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
            {tab === "tenant" ? "Your deposit, protected and earning" : "Deposits, handled for you"}
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            {tab === "tenant"
              ? "It comes back automatically when you move out. If your landlord claims damage, they have to prove it."
              : "No deposit admin. Approve a release in one click, or raise an evidenced claim that independent jurors decide. You earn a share of the interest."}
          </p>
          <div className="sm:hidden flex justify-center gap-2 mt-6">
            {(["tenant", "landlord"] as const).map((k) => (
              <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${tab === k ? "bg-primary text-white" : "bg-white text-gray-600"}`}>
                {k === "tenant" ? "I'm a tenant" : "Landlord / Agent"}
              </button>
            ))}
          </div>
        </div>

        {!publicKey ? (
          <div className="max-w-xl mx-auto bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 text-center">
            <p className="text-gray-700 dark:text-gray-300 mb-6">
              {tab === "tenant" ? "Connect your wallet to see your deposit." : "Connect your wallet to see the deposits held for you."}
            </p>
            <div className="flex justify-center"><WalletMultiButton /></div>
            <ul className="text-left text-sm text-gray-600 dark:text-gray-400 mt-8 space-y-2">
              <li>✅ Held by software, not by your landlord</li>
              <li>✅ Paid back automatically if no claim is raised</li>
              <li>✅ You earn {share}% of the interest</li>
              <li>✅ Disputes decided by independent jurors; silence never counts against you</li>
            </ul>
          </div>
        ) : loadError ? (
          <div className="max-w-2xl mx-auto bg-red-50 text-error rounded-xl p-6">{loadError}</div>
        ) : tab === "landlord" ? (
          cfg && program && publicKey && <LandlordView program={program} me={publicKey} cfg={cfg} now={now} run={run} refreshKey={refreshKey} />
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
              <StatCard title="Deposits locked" value={`${fmt(lockedTotal)}`} subtitle={`${active.length} ${active.length === 1 ? "tenancy" : "tenancies"} · tUSDC`} color="blue" icon="🔒" />
              <StatCard title="Your interest share" value={`${share}%`} subtitle="Paid out with your deposit" color="yellow" icon="📈" />
              <StatCard
                title="Next payment"
                value={next === undefined ? "—" : next === 0 ? "Ready" : fmtDuration(next)}
                subtitle={next === 0 ? "You can release it now" : next === undefined ? "After your tenancy ends" : active.some((t) => t.status === "claimed") ? "When the jurors' decision is in" : "Automatic refund if no claim"}
                color="green"
                icon="⏱️"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-6">
                {paid.map((r) => (
                  <div key={r.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border-l-4 border-green-500 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm text-gray-500">Deposit paid back</p>
                      <p className="text-2xl font-bold text-green-600">✓ {fmt(r.principal)} tUSDC deposit settled</p>
                      <p className="text-xs text-gray-500 mt-1">Your share, plus your interest, is now in your wallet. Balance: {fmt(balance)} tUSDC</p>
                    </div>
                    <button onClick={() => setPaid((p) => p.filter((x) => x.id !== r.id))} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
                  </div>
                ))}
                {active.length === 0 && paid.length === 0 && (
                  <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 text-center text-gray-500">
                    No deposits yet. Pay one with the form →
                  </div>
                )}
                {cfg && program && active.map((t) => (
                  <TenancyCard key={t.address.toBase58()} t={t} cfg={cfg} vaultBalance={vaults[t.address.toBase58()] ?? 0} now={now} program={program} run={run} />
                ))}
              </div>
              <div>{cfg && program && <PayDepositForm program={program} cfg={cfg} balance={balance} run={run} />}</div>
            </div>
          </>
        )}
      </main>

      {toast && (
        <div
          className={`fixed bottom-6 right-6 max-w-sm rounded-xl shadow-custom px-5 py-4 text-sm font-medium text-white ${
            toast.kind === "busy" ? "bg-primary" : toast.kind === "ok" ? "bg-secondary" : "bg-error"
          }`}
          onClick={() => toast.kind !== "busy" && setToast(null)}
        >
          {toast.text}
          {toast.sig && <div className="text-xs opacity-80 mt-1 break-all">tx {toast.sig.slice(0, 20)}…</div>}
        </div>
      )}

      <footer className="text-center text-xs text-gray-400 py-10">
        UltraRentz · test tokens only · Solana {CLUSTER_LABEL} · program 13BK…TzX
      </footer>
    </div>
  );
}
