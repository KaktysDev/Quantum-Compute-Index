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
