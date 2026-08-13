import BillingManager, { type LedgerEntry } from "@/components/BillingManager";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "QRouter Console — Billing" };

export default async function BillingPage() {
  let balance = 10;
  let billingComplete = false;
  let ledger: LedgerEntry[] = [];

  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: member } = await supabase
        .from("organization_members")
        .select("organization_id,organizations(billing_setup_complete)")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      if (member) {
        // The ledger is readable through RLS ("ledger member read"), so this
        // stays on the user's own session rather than the admin client.
        const [credits, entries] = await Promise.all([
          supabase
            .from("credit_accounts")
            .select("available")
            .eq("organization_id", member.organization_id)
            .maybeSingle(),
          supabase
            .from("ledger_entries")
            .select("id,type,amount,balance_after,created_at,job_id")
            .eq("organization_id", member.organization_id)
            .order("created_at", { ascending: false })
            .limit(50),
        ]);
        balance = Number(credits.data?.available ?? 0);
        ledger = (entries.data ?? []) as LedgerEntry[];
        const organization = Array.isArray(member.organizations) ? member.organizations[0] : member.organizations;
        billingComplete = Boolean(
          (organization as { billing_setup_complete?: boolean } | null)?.billing_setup_complete,
        );
      }
    }
  }

  return (
    <div className="console-page">
      <div className="console-page-heading compact">
        <div>
          <h1>Billing</h1>
        </div>
      </div>
      <BillingManager balance={balance} billingComplete={billingComplete} ledger={ledger} />
    </div>
  );
}
