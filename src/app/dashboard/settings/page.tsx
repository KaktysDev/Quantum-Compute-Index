import SettingsForm from "@/components/SettingsForm";
import { PageHeader } from "@/components/console/ui";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata = { title: "QRouter Console — Settings" };

type Initial = {
  fullName: string;
  email: string;
  organization: string;
  preferences: { completionEmails?: boolean; failureAlerts?: boolean; defaultRouting?: string; theme?: string };
};

async function loadInitial(): Promise<Initial> {
  const fallback: Initial = { fullName: "Local developer", email: "developer@local", organization: "Local workspace", preferences: {} };
  if (!isSupabaseConfigured()) return fallback;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fallback;
  const [{ data: profile }, { data: member }] = await Promise.all([
    supabase.from("profiles").select("full_name,preferences").eq("id", user.id).maybeSingle(),
    supabase.from("organization_members").select("organizations(name)").eq("user_id", user.id).limit(1).maybeSingle(),
  ]);
  const org = Array.isArray(member?.organizations) ? member.organizations[0] : member?.organizations;
  return {
    fullName: profile?.full_name ?? "",
    email: user.email ?? "",
    organization: (org as { name?: string } | null)?.name ?? "Workspace",
    preferences: (profile?.preferences ?? {}) as Initial["preferences"],
  };
}

export default async function SettingsPage() {
  const initial = await loadInitial();
  return (
    <div className="console-page">
      <PageHeader title="Settings" description="Theme lives in the account menu at the bottom of the sidebar." />
      <SettingsForm initial={initial} />
    </div>
  );
}
