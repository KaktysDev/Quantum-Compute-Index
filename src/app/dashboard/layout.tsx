import { redirect } from "next/navigation";
import DashboardNav from "@/components/DashboardNav";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import "./dashboard.css";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let email: string | null = "developer@local";
  let organization = "Local workspace";
  let balance = 10;
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/");
    email = user.email ?? null;
    const { data: profile } = await supabase.from("profiles").select("onboarding_complete").eq("id", user.id).maybeSingle();
    if (profile && !profile.onboarding_complete) redirect("/onboarding");
    const { data: member } = await supabase.from("organization_members").select("organization_id, organizations(name)").eq("user_id", user.id).limit(1).maybeSingle();
    if (member) {
      const org = Array.isArray(member.organizations) ? member.organizations[0] : member.organizations;
      organization = (org as { name?: string } | null)?.name ?? organization;
      const { data: credits } = await supabase.from("credit_accounts").select("available").eq("organization_id", member.organization_id).maybeSingle();
      balance = Number(credits?.available ?? 0);
    }
  }

  return (
    <div className="console-shell min-h-screen">
      <DashboardNav email={email} organization={organization} balance={balance} />
      <div className="console-main">{children}</div>
    </div>
  );
}
