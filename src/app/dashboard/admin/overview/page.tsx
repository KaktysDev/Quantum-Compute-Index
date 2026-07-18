import Link from "next/link";
import {
  Activity,
  ArrowRight,
  CircleDollarSign,
  Cpu,
  Database,
  Inbox,
  Users,
} from "lucide-react";
import GlassCard from "@/components/GlassCard";
import { requireAdmin } from "@/lib/admin";
import { getLatestSnapshot } from "@/lib/qci/store";

export const dynamic = "force-dynamic";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function StatCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
}) {
  return (
    <GlassCard className="p-5">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--muted)]">{label}</p>
        <span className="text-[var(--qr-emerald,#34d399)]">{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
      {sub && <p className="mt-1 text-xs text-[var(--muted)]">{sub}</p>}
    </GlassCard>
  );
}

export default async function AdminOverviewPage() {
  const { supabase } = await requireAdmin();

  const [
    { count: userCount },
    { data: jobRows },
    { data: ledgerRows },
    { data: creditRows },
    { data: backendRows },
    { count: openReports },
    { count: unreadContacts },
    latest,
  ] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("jobs").select("status, selected_backend_id, created_at").order("created_at", { ascending: false }).limit(2000),
    supabase.from("ledger_entries").select("type, amount"),
    supabase.from("credit_accounts").select("available, reserved"),
    supabase.from("backends").select("id, provider, display_name, status, kind, queue_seconds, updated_at"),
    supabase.from("user_reports").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress"]),
    supabase.from("contact_submissions").select("id", { count: "exact", head: true }).eq("read", false),
    getLatestSnapshot(),
  ]);

  const jobs = jobRows ?? [];
  const statusCounts = jobs.reduce<Record<string, number>>((acc, j) => {
    acc[j.status] = (acc[j.status] ?? 0) + 1;
    return acc;
  }, {});

  // Provider usage distribution (jobs → backend → provider).
  const backendById = new Map((backendRows ?? []).map((b) => [b.id, b]));
  const providerUse = jobs.reduce<Record<string, number>>((acc, j) => {
    if (!j.selected_backend_id) return acc;
    const provider = backendById.get(j.selected_backend_id)?.provider ?? j.selected_backend_id;
    acc[provider] = (acc[provider] ?? 0) + 1;
    return acc;
  }, {});
  const providerRanking = Object.entries(providerUse).sort((a, b) => b[1] - a[1]);
  const maxUse = providerRanking[0]?.[1] ?? 1;

  const purchased = (ledgerRows ?? []).filter((l) => l.type === "purchase").reduce((s, l) => s + Number(l.amount), 0);
  const charged = (ledgerRows ?? []).filter((l) => l.type === "charge").reduce((s, l) => s + Math.abs(Number(l.amount)), 0);
  const floatBalance = (creditRows ?? []).reduce((s, c) => s + Number(c.available) + Number(c.reserved), 0);

  const online = (backendRows ?? []).filter((b) => b.status === "online").length;
  const degraded = (backendRows ?? []).filter((b) => b.status === "degraded").length;
  const offline = (backendRows ?? []).filter((b) => b.status === "offline").length;

  const staleProviders = latest.components.filter((c) => c.status === "stale").map((c) => c.provider);
  const snapshotAge = Math.round((Date.now() - new Date(latest.ts).getTime()) / 3_600_000);

  return (
    <div className="flex flex-col gap-6">
      {/* Headline stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Users" value={String(userCount ?? 0)} sub="Registered accounts" icon={<Users size={15} />} />
        <StatCard
          label="Jobs (recent 2000)"
          value={String(jobs.length)}
          sub={`${statusCounts.completed ?? 0} completed · ${statusCounts.failed ?? 0} failed · ${(statusCounts.queued ?? 0) + (statusCounts.dispatching ?? 0) + (statusCounts.processing ?? 0) + (statusCounts.submitted ?? 0)} in flight`}
          icon={<Activity size={15} />}
        />
        <StatCard
          label="Revenue"
          value={usd(purchased)}
          sub={`${usd(charged)} consumed · ${usd(floatBalance)} float outstanding`}
          icon={<CircleDollarSign size={15} />}
        />
        <StatCard
          label="Open tickets"
          value={String((openReports ?? 0) + (unreadContacts ?? 0))}
          sub={`${openReports ?? 0} support · ${unreadContacts ?? 0} unread contact`}
          icon={<Inbox size={15} />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* QCI state */}
        <GlassCard className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white"><Database size={14} /> QCI index</h2>
            <Link href="/dashboard/admin/health" className="flex items-center gap-1 text-xs text-[var(--qr-emerald,#34d399)] hover:underline">
              Health <ArrowRight size={11} />
            </Link>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--muted)]">$/QC-hour</p>
              <p className="mt-1 text-xl font-semibold text-white">{usd(latest.vwap)}</p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--muted)]">Index level</p>
              <p className="mt-1 text-xl font-semibold text-white">{latest.price.toFixed(2)}</p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--muted)]">Source</p>
              <p className={`mt-1 text-xl font-semibold ${latest.source === "live" ? "text-[var(--qr-emerald,#34d399)]" : "text-amber-300"}`}>
                {latest.source.toUpperCase()}
              </p>
            </div>
          </div>
          <p className="mt-4 text-xs text-[var(--muted)]">
            Last update: <b className={snapshotAge > 30 ? "text-amber-300" : "text-white"}>{new Date(latest.ts).toLocaleString()}</b>
            {" "}({snapshotAge}h ago{snapshotAge > 30 ? " — daily cron may be failing" : ""})
            {staleProviders.length > 0 && (
              <> · carried forward: <b className="text-amber-300">{staleProviders.join(", ")}</b></>
            )}
          </p>
        </GlassCard>

        {/* Backend status */}
        <GlassCard className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white"><Cpu size={14} /> Backends</h2>
            <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--muted)]">
              <b className="text-[var(--qr-emerald,#34d399)]">{online} up</b> · <b className="text-amber-300">{degraded} degraded</b> · <b className="text-red-400">{offline} down</b>
            </span>
          </div>
          <div className="mt-4 flex flex-col gap-2">
            {(backendRows ?? []).map((b) => (
              <div key={b.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-black/20 px-3 py-2">
                <span className="text-xs text-white">{b.display_name} <span className="text-[var(--muted)]">· {b.provider} · {b.kind}</span></span>
                <span className={`font-mono text-[10px] uppercase tracking-widest ${
                  b.status === "online" ? "text-[var(--qr-emerald,#34d399)]" : b.status === "degraded" ? "text-amber-300" : "text-red-400"
                }`}>
                  {b.status}
                </span>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>

      {/* Provider usage */}
      <GlassCard className="p-6">
        <h2 className="text-sm font-semibold text-white">Provider usage (all users, recent jobs)</h2>
        {providerRanking.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted)]">No routed jobs yet.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-2.5">
            {providerRanking.map(([provider, count]) => (
              <div key={provider} className="grid grid-cols-[140px_1fr_60px] items-center gap-3">
                <span className="truncate text-xs text-white">{provider}</span>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                  <div className="h-full rounded-full bg-[var(--qr-emerald,#34d399)]/70" style={{ width: `${(count / maxUse) * 100}%` }} />
                </div>
                <span className="text-right font-mono text-xs text-[var(--muted)]">{count}</span>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
