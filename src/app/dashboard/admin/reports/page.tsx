import ReportsManager, {
  type AdminContact,
  type AdminReport,
} from "@/components/admin/ReportsManager";
import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

export default async function AdminReportsPage() {
  const { supabase } = await requireAdmin();

  const [{ data: reports }, { data: contacts }] = await Promise.all([
    supabase
      .from("user_reports")
      .select("id, email, category, subject, message, status, admin_notes, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("contact_submissions")
      .select("id, name, email, phone, message, read, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  return (
    <ReportsManager
      reports={(reports ?? []) as AdminReport[]}
      contacts={(contacts ?? []) as AdminContact[]}
    />
  );
}
