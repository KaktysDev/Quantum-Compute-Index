import { redirect } from "next/navigation";
import RouterTopbar from "@/components/RouterTopbar";
import { checkIsAdmin } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { canAccessConsole, consoleDevBypassEnabled } from "@/lib/access";
import "./console.css";
import "./chat.css";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let email: string | null = "developer@local";
  let organization = "Local workspace";
  let balance = 10;
  let isAdmin = false;
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/signin");
    email = user.email ?? null;
    if (!(await canAccessConsole(supabase))) redirect("/access-denied");
    isAdmin = await checkIsAdmin(supabase);
    const { data: profile } = await supabase.from("profiles").select("onboarding_complete").eq("id", user.id).maybeSingle();
    if (profile && !profile.onboarding_complete) redirect("/onboarding");
    const { data: member } = await supabase.from("organization_members").select("organization_id, organizations(name)").eq("user_id", user.id).limit(1).maybeSingle();
    if (member) {
      const org = Array.isArray(member.organizations) ? member.organizations[0] : member.organizations;
      organization = (org as { name?: string } | null)?.name ?? organization;
      const { data: credits } = await supabase.from("credit_accounts").select("available").eq("organization_id", member.organization_id).maybeSingle();
      balance = Number(credits?.available ?? 0);
    }
  } else if (!consoleDevBypassEnabled()) redirect("/signin");

  return (
    <div className="console-shell min-h-screen">
      <RouterTopbar email={email} organization={organization} balance={balance} isAdmin={isAdmin} />
      <div className="console-main">{children}</div>
    </div>
  );
}
