import { redirect } from "next/navigation";
import SupportPanel, { type UserReport } from "@/components/SupportPanel";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default async function SupportPage() {
  let reports: UserReport[] = [];
  if (isSupabaseConfigured()) {
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
          <p className="qr-eyebrow"><span /> Help center</p>
          <h1>Support</h1>
          <p>Report bugs, billing problems, or provider issues — the team tracks every ticket.</p>
        </div>
      </div>
      <SupportPanel reports={reports} />
    </div>
  );
}
