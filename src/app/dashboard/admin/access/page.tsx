import AccessManager, {
  type AllowedEntry,
  type WaitlistEntry,
} from "@/components/admin/AccessManager";
import { requireAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function AdminAccessPage() {
  await requireAdmin();

  // allowed_emails / admin_emails have RLS on with no policies, and the
  // waitlist is service-role only — read them all through the service role.
  const admin = createAdminClient();
  const [waitlist, allowed, admins] = await Promise.all([
    admin
      .from("waitlist_submissions")
      .select("id,name,email,linkedin_url,job_title,quantum_experience,referral_source,status,created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    admin.from("allowed_emails").select("email,added_by,created_at").order("created_at", { ascending: false }),
    admin.from("admin_emails").select("email"),
  ]);

  const adminEmails = new Set((admins.data ?? []).map((r) => String(r.email).toLowerCase()));
  const migrationNeeded = Boolean(allowed.error || admins.error);

  const entries: WaitlistEntry[] = (waitlist.data ?? []).map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    email: String(r.email),
    linkedinUrl: String(r.linkedin_url),
    jobTitle: String(r.job_title),
    quantumExperience: String(r.quantum_experience),
    referralSource: String(r.referral_source),
    status: String(r.status),
    createdAt: String(r.created_at),
  }));

  const access: AllowedEntry[] = (allowed.data ?? []).map((r) => ({
    email: String(r.email),
    addedBy: r.added_by ? String(r.added_by) : null,
    createdAt: String(r.created_at),
    isAdmin: adminEmails.has(String(r.email).toLowerCase()),
  }));

  return <AccessManager waitlist={entries} access={access} migrationNeeded={migrationNeeded} />;
}
