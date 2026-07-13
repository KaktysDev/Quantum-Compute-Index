import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CreditCard, KeyRound, Receipt, Server } from "lucide-react";
import GlassCard from "@/components/GlassCard";
import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const LEDGER_LABEL: Record<string, string> = {
  purchase: "Credit purchase",
  reserve: "Reserved for job",
  release: "Reservation released",
  charge: "Job charge",
  refund: "Refund",
  adjustment: "Manual adjustment",
};

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ supabase }, { id }] = await Promise.all([requireAdmin(), params]);

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, company, stripe_customer_id, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!profile) notFound();

  const { data: memberships } = await supabase
    .from("organization_members")
    .select("organization_id, role, organizations(name, slug, stripe_customer_id)")
    .eq("user_id", id);
  const orgIds = (memberships ?? []).map((m) => m.organization_id);

  const [{ data: credits }, { data: jobs }, { data: ledger }, { data: apiKeys }, { data: backends }] =
    await Promise.all([
      orgIds.length
        ? supabase.from("credit_accounts").select("organization_id, available, reserved").in("organization_id", orgIds)
        : Promise.resolve({ data: [] as { organization_id: string; available: number; reserved: number }[] }),
      supabase
        .from("jobs")
        .select("id, name, status, selected_backend_id, target, routing_mode, shots, created_at, quote_id")
        .eq("user_id", id)
        .order("created_at", { ascending: false })
        .limit(50),
      orgIds.length
        ? supabase.from("ledger_entries").select("id, organization_id, type, amount, balance_after, external_id, created_at").in("organization_id", orgIds).order("created_at", { ascending: false }).limit(50)
        : Promise.resolve({ data: [] as never[] }),
      orgIds.length
        ? supabase.from("api_keys").select("id, name, key_prefix, environment, last_used_at, revoked_at, created_at").in("organization_id", orgIds).order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as never[] }),
      supabase.from("backends").select("id, provider, display_name"),
    ]);

  // Quote totals for the listed jobs (invoice-style per-job pricing).
  const quoteIds = (jobs ?? []).map((j) => j.quote_id).filter(Boolean) as string[];
  const { data: quotes } = quoteIds.length
    ? await supabase.from("quotes").select("id, total, currency").in("id", quoteIds)
    : { data: [] as { id: string; total: number; currency: string }[] };
  const quoteById = new Map((quotes ?? []).map((q) => [q.id, q]));
  const backendById = new Map((backends ?? []).map((b) => [b.id, b]));

  const totalBalance = (credits ?? []).reduce((s, c) => s + Number(c.available), 0);
  const totalReserved = (credits ?? []).reduce((s, c) => s + Number(c.reserved), 0);

  const providersUsed = [
    ...new Set(
      (jobs ?? [])
        .map((j) => (j.selected_backend_id ? backendById.get(j.selected_backend_id)?.provider : null))
        .filter(Boolean) as string[],
    ),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/dashboard/admin/users" className="inline-flex items-center gap-1 text-xs text-[var(--muted)] hover:text-white">
          <ArrowLeft size={12} /> All users
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-white">{profile.full_name || profile.email}</h2>
            <p className="mt-0.5 text-sm text-[var(--muted)]">
              {profile.email}{profile.company ? ` · ${profile.company}` : ""} · joined {new Date(profile.created_at).toLocaleDateString()}
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--muted)]">Balance / reserved</p>
            <p className="text-lg font-semibold text-[var(--qr-emerald,#34d399)]">{usd(totalBalance)} <span className="text-sm text-[var(--muted)]">/ {usd(totalReserved)}</span></p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Workspace + billing identity */}
        <GlassCard className="p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><CreditCard size={14} /> Billing & workspace</h3>
          <dl className="mt-3 flex flex-col gap-2 text-sm">
            {(memberships ?? []).map((m) => {
              const org = Array.isArray(m.organizations) ? m.organizations[0] : m.organizations;
              return (
                <div key={m.organization_id} className="flex items-center justify-between rounded-lg border border-white/5 bg-black/20 px-3 py-2">
                  <span className="text-white">{(org as { name?: string } | null)?.name ?? m.organization_id}</span>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--muted)]">{m.role}</span>
                </div>
              );
            })}
            <div className="flex items-center justify-between px-1 text-xs">
              <span className="text-[var(--muted)]">Stripe customer</span>
              <span className="font-mono text-white">{profile.stripe_customer_id ?? "not created"}</span>
            </div>
            <div className="flex items-center justify-between px-1 text-xs">
              <span className="text-[var(--muted)]">Providers used</span>
              <span className="font-mono text-white">{providersUsed.length ? providersUsed.join(", ") : "—"}</span>
            </div>
          </dl>
        </GlassCard>

        {/* API keys */}
        <GlassCard className="p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><KeyRound size={14} /> API keys</h3>
          {(apiKeys ?? []).length === 0 ? (
            <p className="mt-3 text-sm text-[var(--muted)]">No API keys created.</p>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {(apiKeys ?? []).map((k) => (
                <div key={k.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-black/20 px-3 py-2 text-xs">
                  <span className="text-white">{k.name} <span className="font-mono text-[var(--muted)]">{k.key_prefix}…</span></span>
                  <span className={`font-mono text-[10px] uppercase tracking-widest ${k.revoked_at ? "text-red-400" : "text-[var(--qr-emerald,#34d399)]"}`}>
                    {k.revoked_at ? "revoked" : k.environment}
                    {k.last_used_at ? ` · used ${new Date(k.last_used_at).toLocaleDateString()}` : " · never used"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>

      {/* Jobs */}
      <GlassCard className="overflow-x-auto">
        <div className="flex items-center justify-between px-4 pt-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><Server size={14} /> Jobs (latest 50)</h3>
        </div>
        {(jobs ?? []).length === 0 ? (
          <p className="px-4 py-6 text-sm text-[var(--muted)]">No jobs submitted.</p>
        ) : (
          <table className="mt-2 w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 font-mono text-[10px] uppercase tracking-widest text-[var(--muted)]">
                <th className="px-4 py-2.5">Job</th>
                <th className="px-4 py-2.5">Backend / provider</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Shots</th>
                <th className="px-4 py-2.5 text-right">Quote</th>
                <th className="px-4 py-2.5 text-right">Created</th>
              </tr>
            </thead>
            <tbody>
              {(jobs ?? []).map((j) => {
                const backend = j.selected_backend_id ? backendById.get(j.selected_backend_id) : null;
                const quote = j.quote_id ? quoteById.get(j.quote_id) : null;
                return (
                  <tr key={j.id} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-2.5">
                      <p className="text-white">{j.name || j.id.slice(0, 8)}</p>
                      <p className="font-mono text-[10px] text-[var(--muted)]">{j.target} · {j.routing_mode}</p>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[var(--muted)]">
                      {backend ? <>{backend.display_name} <span className="font-mono">({backend.provider})</span></> : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`font-mono text-[10px] uppercase tracking-widest ${
                        j.status === "completed" ? "text-[var(--qr-emerald,#34d399)]" : j.status === "failed" || j.status === "cancelled" ? "text-red-400" : "text-amber-300"
                      }`}>{j.status}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-white">{j.shots}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-white">{quote ? usd(Number(quote.total)) : "—"}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-[10px] text-[var(--muted)]">{new Date(j.created_at).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </GlassCard>

      {/* Ledger / invoices */}
      <GlassCard className="overflow-x-auto">
        <div className="flex items-center justify-between px-4 pt-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><Receipt size={14} /> Billing ledger (latest 50)</h3>
        </div>
        {(ledger ?? []).length === 0 ? (
          <p className="px-4 py-6 text-sm text-[var(--muted)]">No transactions.</p>
        ) : (
          <table className="mt-2 w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 font-mono text-[10px] uppercase tracking-widest text-[var(--muted)]">
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5 text-right">Amount</th>
                <th className="px-4 py-2.5 text-right">Balance after</th>
                <th className="px-4 py-2.5">Reference</th>
                <th className="px-4 py-2.5 text-right">Date</th>
              </tr>
            </thead>
            <tbody>
              {(ledger ?? []).map((l) => (
                <tr key={l.id} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-2.5 text-xs text-white">{LEDGER_LABEL[l.type] ?? l.type}</td>
                  <td className={`px-4 py-2.5 text-right font-mono text-xs ${Number(l.amount) >= 0 ? "text-[var(--qr-emerald,#34d399)]" : "text-red-400"}`}>
                    {Number(l.amount) >= 0 ? "+" : ""}{usd(Number(l.amount))}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-white">{usd(Number(l.balance_after))}</td>
                  <td className="px-4 py-2.5 font-mono text-[10px] text-[var(--muted)]">{l.external_id ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-[10px] text-[var(--muted)]">{new Date(l.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </GlassCard>
    </div>
  );
}
