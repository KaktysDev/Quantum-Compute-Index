import Link from "next/link";
import { Money, Panel } from "@/components/console/ui";
import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

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

  const backendProvider = new Map((backends ?? []).map((backend) => [backend.id, backend.provider]));
  const orgByUser = new Map<string, string>();
  for (const member of members ?? []) if (!orgByUser.has(member.user_id)) orgByUser.set(member.user_id, member.organization_id);
  const creditByOrg = new Map((credits ?? []).map((credit) => [credit.organization_id, credit]));

  const spendByOrg = new Map<string, number>();
  const purchasedByOrg = new Map<string, number>();
  for (const entry of ledger ?? []) {
    if (entry.type === "charge") spendByOrg.set(entry.organization_id, (spendByOrg.get(entry.organization_id) ?? 0) + Math.abs(Number(entry.amount)));
    if (entry.type === "purchase") purchasedByOrg.set(entry.organization_id, (purchasedByOrg.get(entry.organization_id) ?? 0) + Number(entry.amount));
  }

  const jobsByUser = new Map<string, { count: number; providers: Set<string> }>();
  for (const job of jobs ?? []) {
    if (!job.user_id) continue;
    const entry = jobsByUser.get(job.user_id) ?? { count: 0, providers: new Set<string>() };
    entry.count += 1;
    if (job.selected_backend_id) entry.providers.add(backendProvider.get(job.selected_backend_id) ?? job.selected_backend_id);
    jobsByUser.set(job.user_id, entry);
  }

  const rows = (profiles ?? []).map((profile) => {
    const orgId = orgByUser.get(profile.id);
    const credit = orgId ? creditByOrg.get(orgId) : undefined;
    const usage = jobsByUser.get(profile.id);
    return {
      id: String(profile.id),
      email: profile.email,
      name: profile.full_name,
      company: profile.company,
      created_at: profile.created_at,
      balance: Number(credit?.available ?? 0),
      purchased: orgId ? purchasedByOrg.get(orgId) ?? 0 : 0,
      spent: orgId ? spendByOrg.get(orgId) ?? 0 : 0,
      jobCount: usage?.count ?? 0,
      providers: usage ? [...usage.providers] : [],
    };
  });

  return (
    <Panel title="Users" description={`${rows.length} accounts`} flush>
      <div className="table-wrap">
        <table className="qr-table">
          <thead>
            <tr>
              <th>User</th>
              <th className="hide-sm">Joined</th>
              <th className="num">Jobs</th>
              <th className="hide-sm">Providers</th>
              <th className="num hide-sm">Purchased</th>
              <th className="num">Charged</th>
              <th className="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="empty-row">No users.</td></tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link href={`/dashboard/admin/users/${row.id}`} className="cell-main">
                      <b>{row.name || row.email || row.id.slice(0, 8)}</b>
                      <small>{row.email}{row.company ? ` · ${row.company}` : ""}</small>
                    </Link>
                  </td>
                  <td className="hide-sm muted">{new Date(row.created_at).toLocaleDateString()}</td>
                  <td className="num">{row.jobCount.toLocaleString()}</td>
                  <td className="hide-sm muted">{row.providers.length ? row.providers.join(", ") : "—"}</td>
                  <td className="num hide-sm"><Money value={row.purchased} /></td>
                  <td className="num"><Money value={row.spent} /></td>
                  <td className="num"><Money value={row.balance} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
