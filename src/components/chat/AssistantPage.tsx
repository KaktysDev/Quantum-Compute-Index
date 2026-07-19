// Server wrapper for the console assistant: resolves the user's display name
// and credit balance, then renders the chat. Shared by /dashboard (the console
// home) and /dashboard/submit (the "Submit a task" tab).

import QuantumChat from "@/components/chat/QuantumChat";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default async function AssistantPage() {
  let userName = "developer";
  let balance: number | null = 10;

  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.email) userName = user.email.split("@")[0];
    balance = null;
    if (user) {
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
      <QuantumChat userName={userName} balance={balance} />
    </div>
  );
}
