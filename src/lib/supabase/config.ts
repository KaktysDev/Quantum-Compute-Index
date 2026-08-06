// Central place to read Supabase env + check whether the app is wired up.
// When env is missing (e.g. fresh clone, no .env), the public landing page
// still renders with sample data instead of crashing.

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// Requires a real https URL (so placeholder values in .env.local fall back to
// sample-data mode instead of crashing the Supabase client).
export function isSupabaseConfigured(): boolean {
  return /^https?:\/\/.+\..+/.test(SUPABASE_URL) && SUPABASE_ANON_KEY.length > 20;
}

/**
 * Stricter check for code paths that are about to authenticate a caller or
 * perform a service-role write. `isSupabaseConfigured()` deliberately ignores
 * the service-role key so the public landing page keeps rendering sample data
 * on a fresh clone; a half-configured deployment (URL + anon key present, no
 * service-role key) must NOT be mistaken for "no backend at all", because that
 * is what lets authentication fall through to an unauthenticated principal.
 *
 * Read at call time rather than module load so a deployment that injects the
 * secret late — and tests — see the current value. The value itself is never
 * logged or returned.
 */
export function isSupabaseServiceConfigured(): boolean {
  return isSupabaseConfigured() && (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").length > 20;
}
