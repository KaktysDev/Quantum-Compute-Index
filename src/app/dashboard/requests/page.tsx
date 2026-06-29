import { redirect } from "next/navigation";
import GlassCard from "@/components/GlassCard";
import RequestItem, { type ContactSubmission } from "@/components/RequestItem";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default async function RequestsPage() {
  if (!isSupabaseConfigured()) redirect("/");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  // Gate: only hardcoded viewer accounts may see this page.
  let isViewer = false;
  try {
    const { data } = await supabase.rpc("is_contact_viewer");
    isViewer = data === true;
  } catch {
    isViewer = false;
  }
  if (!isViewer) redirect("/dashboard");

  const { data: rows } = await supabase
    .from("contact_submissions")
    .select("id, name, email, phone, message, read, created_at")
    .order("created_at", { ascending: false });

  const submissions = (rows ?? []) as ContactSubmission[];
  const unread = submissions.filter((s) => !s.read).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Access requests</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Submissions from the “Request access” form. Visible only to approved accounts.
          </p>
        </div>
        <span className="mono-label">
          {submissions.length} total · {unread} unread
        </span>
      </div>

      {submissions.length === 0 ? (
        <GlassCard className="p-10 text-center">
          <p className="text-sm text-[var(--muted)]">No requests yet.</p>
        </GlassCard>
      ) : (
        <div className="flex flex-col gap-4">
          {submissions.map((s) => (
            <RequestItem key={s.id} item={s} />
          ))}
        </div>
      )}
    </div>
  );
}
