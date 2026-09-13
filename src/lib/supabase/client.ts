"use client";

import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import { asUntypedClient } from "./untyped";

/** Browser-side Supabase client (uses the public anon key). */
export function createClient() {
  return asUntypedClient(createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY));
}
