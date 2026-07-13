import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * Admin gating. Admins are the hardcoded emails in public.admin_emails
 * (managed via the Supabase SQL editor — see supabase/admin.sql). The check
 * runs through the security-definer RPC `is_admin()`, so the allowlist table
 * itself stays unreadable to clients.
 */
export async function checkIsAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<boolean> {
  try {
    const { data } = await supabase.rpc("is_admin");
    return data === true;
  } catch {
    return false;
  }
}

/** Server-component guard: returns {supabase, user} or redirects non-admins away. */
export async function requireAdmin() {
  if (!isSupabaseConfigured()) redirect("/dashboard/providers");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");
  if (!(await checkIsAdmin(supabase))) redirect("/dashboard/providers");
  return { supabase, user };
}

/** API-route guard: returns the context or null (caller responds 401/403). */
export async function requireAdminApi() {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  if (!(await checkIsAdmin(supabase))) return null;
  return { supabase, user };
}
