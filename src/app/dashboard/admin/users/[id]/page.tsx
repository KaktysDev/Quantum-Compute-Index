import Link from "next/link";
import { notFound } from "next/navigation";
import { Money, Panel, Stat, StatGrid, StatusBadge } from "@/components/console/ui";
import { requireAdmin } from "@/lib/admin";
import { formatUsd } from "@/lib/qrouter/cost";

export const dynamic = "force-dynamic";

const LEDGER_LABEL: Record<string, string> = {
  purchase: "Credit purchase",
  reserve: "Reserved for job",
  release: "Reservation released",
  charge: "Job charge",
  refund: "Refund",
  adjustment: "Manual adjustment",
};

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
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
  const orgIds = (memberships ?? []).map((membership) => membership.organization_id);

  const [{ data: credits }, { data: jobs }, { data: ledger }, { data: apiKeys }, { data: backends }] = await Promise.all([
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

  const quoteIds = (jobs ?? []).map((job) => job.quote_id).filter(Boolean) as string[];
  const { data: quotes } = quoteIds.length
    ? await supabase.from("quotes").select("id, total, currency").in("id", quoteIds)
    : { data: [] as { id: string; total: number; currency: string }[] };
  const quoteById = new Map((quotes ?? []).map((quote) => [quote.id, quote]));
  const backendById = new Map((backends ?? []).map((backend) => [backend.id, backend]));

  const balance = (credits ?? []).reduce((sum, credit) => sum + Number(credit.available), 0);
  const reserved = (credits ?? []).reduce((sum, credit) => sum + Number(credit.reserved), 0);
  const providersUsed = [
    ...new Set((jobs ?? []).map((job) => (job.selected_backend_id ? backendById.get(job.selected_backend_id)?.provider : null)).filter(Boolean) as string[]),
  ];

  return (
    <div className="stack">
      <div className="stack-sm">
        <nav className="page-crumbs"><Link href="/dashboard/admin/users">Users</Link></nav>
        <h2 className="section-title">{profile.full_name || profile.email}</h2>
        <p className="muted">
          {profile.email}{profile.company ? ` · ${profile.company}` : ""} · joined {new Date(profile.created_at).toLocaleDateString()}
        </p>
      </div>

      <StatGrid>
        <Stat label="Balance" value={<Money value={balance} />} meta={`${formatUsd(reserved)} reserved`} />
        <Stat label="Jobs, latest 50" value={(jobs ?? []).length.toLocaleString()} meta={providersUsed.length ? providersUsed.join(", ") : "No providers used"} />
        <Stat label="API keys" value={(apiKeys ?? []).filter((key) => !key.revoked_at).length.toLocaleString()} meta="Active" />
      </StatGrid>

      <div className="grid-2">
        <Panel title="Workspaces">
          <dl className="kv">
            {(memberships ?? []).map((membership) => {
              const org = Array.isArray(membership.organizations) ? membership.organizations[0] : membership.organizations;
              return (
                <div key={membership.organization_id} style={{ display: "contents" }}>
                  <dt>{(org as { name?: string } | null)?.name ?? membership.organization_id}</dt>
                  <dd className="muted">{membership.role}</dd>
                </div>
              );
            })}
            <dt>Stripe customer</dt>
            <dd className="mono">{profile.stripe_customer_id ?? "Not created"}</dd>
          </dl>
        </Panel>

        <Panel title="API keys" flush>
          <div className="table-wrap">
            <table className="qr-table">
              <thead><tr><th>Name</th><th>State</th><th className="hide-sm">Last used</th></tr></thead>
              <tbody>
                {(apiKeys ?? []).length === 0 ? (
                  <tr><td colSpan={3} className="empty-row">No API keys.</td></tr>
                ) : (
                  (apiKeys ?? []).map((key) => (
                    <tr key={key.id}>
                      <td><span className="cell-main"><b>{key.name}</b><small className="mono">{key.key_prefix}…</small></span></td>
                      <td>{key.revoked_at ? <span className="status neutral">Revoked</span> : <span className="status success">{key.environment}</span>}</td>
                      <td className="hide-sm muted">{key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : "Never"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <Panel title="Jobs" description="Latest 50" flush>
        <div className="table-wrap">
          <table className="qr-table">
            <thead>
              <tr><th>Job</th><th>Status</th><th className="hide-sm">Backend</th><th className="num hide-sm">Shots</th><th className="num">Quote</th><th className="hide-sm">Created</th></tr>
            </thead>
            <tbody>
              {(jobs ?? []).length === 0 ? (
                <tr><td colSpan={6} className="empty-row">No jobs submitted.</td></tr>
              ) : (
                (jobs ?? []).map((job) => {
                  const backend = job.selected_backend_id ? backendById.get(job.selected_backend_id) : null;
                  const quote = job.quote_id ? quoteById.get(job.quote_id) : null;
                  return (
                    <tr key={job.id}>
                      <td><span className="cell-main"><b>{job.name || job.id.slice(0, 8)}</b><small>{job.target} · {job.routing_mode}</small></span></td>
                      <td><StatusBadge status={job.status} /></td>
                      <td className="hide-sm muted">{backend ? `${backend.display_name} (${backend.provider})` : "—"}</td>
                      <td className="num hide-sm">{job.shots}</td>
                      <td className="num"><Money value={quote ? Number(quote.total) : null} /></td>
                      <td className="hide-sm muted">{new Date(job.created_at).toLocaleString()}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Ledger" description="Latest 50 entries" flush>
        <div className="table-wrap">
          <table className="qr-table">
            <thead>
              <tr><th>Type</th><th className="num">Amount</th><th className="num hide-sm">Balance after</th><th className="hide-sm">Reference</th><th className="hide-sm">Date</th></tr>
            </thead>
            <tbody>
              {(ledger ?? []).length === 0 ? (
                <tr><td colSpan={5} className="empty-row">No transactions.</td></tr>
              ) : (
                (ledger ?? []).map((entry) => {
                  const amount = Number(entry.amount);
                  return (
                    <tr key={entry.id}>
                      <td>{LEDGER_LABEL[entry.type] ?? entry.type}</td>
                      <td className={`num${amount > 0 ? " ledger-credit" : ""}`}>{amount > 0 ? "+" : amount < 0 ? "−" : ""}{formatUsd(Math.abs(amount))}</td>
                      <td className="num hide-sm">{formatUsd(Number(entry.balance_after))}</td>
                      <td className="hide-sm mono dim">{entry.external_id ?? "—"}</td>
                      <td className="hide-sm muted">{new Date(entry.created_at).toLocaleString()}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
