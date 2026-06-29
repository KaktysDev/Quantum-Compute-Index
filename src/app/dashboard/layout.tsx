import { redirect } from "next/navigation";
import DashboardNav from "@/components/DashboardNav";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Dashboard requires auth; without Supabase configured there's no session.
  if (!isSupabaseConfigured()) redirect("/");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  // Is this account allowed to see contact submissions? (graceful if the
  // contact tables/function aren't created yet.)
  let isViewer = false;
  let unread = 0;
  try {
    const { data } = await supabase.rpc("is_contact_viewer");
    isViewer = data === true;
    if (isViewer) {
      const { count } = await supabase
        .from("contact_submissions")
        .select("id", { count: "exact", head: true })
        .eq("read", false);
      unread = count ?? 0;
    }
  } catch {
    isViewer = false;
  }

  return (
    <div className="min-h-screen">
      <DashboardNav email={user.email ?? null} isViewer={isViewer} unread={unread} />
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">{children}</div>
    </div>
  );
}
