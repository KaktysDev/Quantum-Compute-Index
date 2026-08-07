// Server wrapper for the console assistant: resolves the user's display name,
// credit balance, and whether the first-run "Get started" panel has already
// been dismissed. Shared by /dashboard (the console home) and the legacy
// /dashboard/submit route.

import QuantumChat from "@/components/chat/QuantumChat";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default async function AssistantPage() {
  let userName = "developer";
  let balance: number | null = 10;
  // The panel keeps its own localStorage record of a dismissal, so it is safe
  // to leave this on by default; the durable per-account flag below only takes
  // over once there is a profiles row to read it from.
  let showGetStarted = true;

  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.email) userName = user.email.split("@")[0];
    balance = null;
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("preferences")
        .eq("id", user.id)
        .maybeSingle();
      const preferences = (profile?.preferences ?? {}) as Record<string, unknown>;
      showGetStarted = preferences.getStartedDismissed !== true;

      const { data: member } = await supabase
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      if (member) {
        const { data: credits } = await supabase
          .from("credit_accounts")
          .select("available")
          .eq("organization_id", member.organization_id)
          .maybeSingle();
        if (credits) balance = Number(credits.available);
      }
    }
  }

  return (
    <div className="console-page qc-page">
      <QuantumChat userName={userName} balance={balance} showGetStarted={showGetStarted} />
    </div>
  );
}
