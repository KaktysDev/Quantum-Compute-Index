import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./config";

/**
 * Service-role Supabase client — SERVER ONLY. Bypasses RLS.
 * Used by the cron job (writing snapshots) and for decrypting provider keys.
 * NEVER import this into client components.
 *
 * Reused across a warm isolate: auth + the route handler used to construct a
 * new supabase-js client (and its fetch agent) on every call in the same
 * request.
 */
let cached: ReturnType<typeof createClient> | null = null;
let cachedStamp = "";

export function createAdminClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!SUPABASE_URL || !serviceKey) {
    throw new Error(
      "Supabase admin client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  const stamp = `${SUPABASE_URL}\0${serviceKey}`;
  if (cached && cachedStamp === stamp) return cached;
  cached = createClient(SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  cachedStamp = stamp;
  return cached;
}
