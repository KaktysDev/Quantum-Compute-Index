import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { canAccessConsole } from "@/lib/access";

/**
 * OAuth redirect target. Exchanges the auth code for a session.
 * If the email is not on the allowlist, the signup trigger fails upstream and
 * Supabase returns an error param → we route the user to /access-denied.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  if (!isSupabaseConfigured()) {
    return NextResponse.redirect(`${origin}/`);
  }
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const requestedNext = searchParams.get("next") ?? "/dashboard";
  const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/dashboard";

  if (error) {
    return NextResponse.redirect(`${origin}/access-denied`);
  }

  if (code) {
    const supabase = await createClient();
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (!exchangeError) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!canAccessConsole(user?.email)) {
        await supabase.auth.signOut();
        return NextResponse.redirect(`${origin}/signin?status=not-authorized`);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/access-denied`);
}
