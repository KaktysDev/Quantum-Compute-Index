// ─────────────────────────────────────────────────────────────────────────────
// Console access gating.
//
// Who may enter /dashboard lives in the DATABASE, not in this file:
//   public.allowed_emails  — granted from Admin → Access (or the SQL editor)
//   public.admin_emails    — edited in the SQL editor; admins always have access
//
// Both tables have RLS on with no policies, so the lists stay unreadable to
// clients. The security-definer RPC below returns only the boolean answer.
// See supabase/access.sql — run it BEFORE deploying: if the function is
// missing the check fails closed and nobody can reach the console.
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal shape shared by the SSR, server, and middleware Supabase clients. */
interface RpcCapableClient {
  rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }>;
}

/** Is the signed-in user allowed into the console? Fails closed on any error. */
export async function canAccessConsole(supabase: RpcCapableClient): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("can_access_console");
    return !error && data === true;
  } catch {
    return false;
  }
}

export function consoleDevBypassEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.QROUTER_DEV_AUTH_BYPASS === "true";
}
