// Resolves the caller's organization for console server components. Reads go
// through the user's session client so RLS scopes them; demo mode reads the
// in-memory stores the demo API writes to.

import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export type ConsoleWorkspace =
  | { mode: "live"; organizationId: string; supabase: Awaited<ReturnType<typeof createClient>> }
  | { mode: "demo"; organizationId: "demo" }
  | { mode: "none" };

export async function getConsoleWorkspace(): Promise<ConsoleWorkspace> {
  if (!isSupabaseConfigured()) return { mode: "demo", organizationId: "demo" };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { mode: "none" };
  const { data: member } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  return member ? { mode: "live", organizationId: member.organization_id, supabase } : { mode: "none" };
}
