import Link from "next/link";
import { ArrowRight } from "lucide-react";
import GlassCard from "@/components/GlassCard";
import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default async function AdminUsersPage() {
  const { supabase } = await requireAdmin();

  const [{ data: profiles }, { data: members }, { data: credits }, { data: jobs }, { data: ledger }, { data: backends }] =
    await Promise.all([
      supabase.from("profiles").select("id, email, full_name, company, stripe_customer_id, created_at").order("created_at", { ascending: false }),
      supabase.from("organization_members").select("organization_id, user_id, role"),
      supabase.from("credit_accounts").select("organization_id, available, reserved"),
      supabase.from("jobs").select("user_id, organization_id, selected_backend_id, status, created_at").order("created_at", { ascending: false }).limit(5000),
      supabase.from("ledger_entries").select("organization_id, type, amount"),
      supabase.from("backends").select("id, provider"),
    ]);

  const backendProvider = new Map((backends ?? []).map((b) => [b.id, b.provider]));
  const orgByUser = new Map<string, string>();
  for (const m of members ?? []) if (!orgByUser.has(m.user_id)) orgByUser.set(m.user_id, m.organization_id);
  const creditByOrg = new Map((credits ?? []).map((c) => [c.organization_id, c]));

  const spendByOrg = new Map<string, number>();
  const purchasedByOrg = new Map<string, number>();
  for (const l of ledger ?? []) {
    if (l.type === "charge") spendByOrg.set(l.organization_id, (spendByOrg.get(l.organization_id) ?? 0) + Math.abs(Number(l.amount)));
    if (l.type === "purchase") purchasedByOrg.set(l.organization_id, (purchasedByOrg.get(l.organization_id) ?? 0) + Number(l.amount));
  }

  const jobsByUser = new Map<string, { count: number; last: string; providers: Set<string> }>();
  for (const j of jobs ?? []) {
    if (!j.user_id) continue;
    const entry = jobsByUser.get(j.user_id) ?? { count: 0, last: j.created_at, providers: new Set<string>() };
    entry.count += 1;
    if (j.selected_backend_id) entry.providers.add(backendProvider.get(j.selected_backend_id) ?? j.selected_backend_id);
    jobsByUser.set(j.user_id, entry);
  }

  const rows = (profiles ?? []).map((p) => {
    const orgId = orgByUser.get(p.id);
    const credit = orgId ? creditByOrg.get(orgId) : undefined;
    const usage = jobsByUser.get(p.id);
    return {
      ...p,
      balance: Number(credit?.available ?? 0),
      reserved: Number(credit?.reserved ?? 0),
      purchased: orgId ? (purchasedByOrg.get(orgId) ?? 0) : 0,
      spent: orgId ? (spendByOrg.get(orgId) ?? 0) : 0,
      jobCount: usage?.count ?? 0,
      providers: usage ? [...usage.providers] : [],
      lastActive: usage?.last ?? null,
    };
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between">
        <h2 className="text-sm font-semibold text-white">All users</h2>
        <span className="mono-label">{rows.length} accounts</span>
      </div>

      <GlassCard className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 font-mono text-[10px] uppercase tracking-widest text-[var(--muted)]">
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Joined</th>
              <th className="px-4 py-3 text-right">Jobs</th>
              <th className="px-4 py-3">Providers used</th>
              <th className="px-4 py-3 text-right">Purchased</th>
              <th className="px-4 py-3 text-right">Spent</th>
              <th className="px-4 py-3 text-right">Balance</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                <td className="px-4 py-3">
                  <p className="font-medium text-white">{r.full_name || r.email || r.id.slice(0, 8)}</p>
                  <p className="text-xs text-[var(--muted)]">{r.email}{r.company ? ` · ${r.company}` : ""}</p>
                </td>
                <td className="px-4 py-3 text-xs text-[var(--muted)]">{new Date(r.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-right font-mono text-xs text-white">{r.jobCount}</td>
                <td className="px-4 py-3">
                  {r.providers.length === 0 ? (
                    <span className="text-xs text-[var(--muted)]">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {r.providers.map((p) => (
                        <span key={p} className="rounded border border-white/10 bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-[var(--muted)]">{p}</span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-white">{usd(r.purchased)}</td>
                <td className="px-4 py-3 text-right font-mono text-xs text-white">{usd(r.spent)}</td>
                <td className="px-4 py-3 text-right font-mono text-xs text-[var(--qr-emerald,#34d399)]">{usd(r.balance)}</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/dashboard/admin/users/${r.id}`} className="inline-flex items-center gap-1 text-xs text-[var(--qr-emerald,#34d399)] hover:underline">
                    Detail <ArrowRight size={11} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </GlassCard>
    </div>
  );
}
