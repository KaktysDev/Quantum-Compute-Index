import { redirect } from "next/navigation";
import SupportPanel, { type UserReport } from "@/components/SupportPanel";
import { consoleDevBypassEnabled } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default async function SupportPage() {
  let reports: UserReport[] = [];
  // Match the dashboard layout and middleware: local auth bypass must not make
  // the Support navigation link bounce back to the public home page.
  if (isSupabaseConfigured() && !consoleDevBypassEnabled()) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/");
    const { data } = await supabase
      .from("user_reports")
      .select("id, category, subject, message, status, admin_notes, created_at")
      .order("created_at", { ascending: false });
    reports = (data ?? []) as UserReport[];
  }

  return (
    <div className="console-page">
      <div className="console-page-heading compact">
        <div>
          <h1>Support</h1>
        </div>
      </div>
      <SupportPanel reports={reports} />
    </div>
  );
}
