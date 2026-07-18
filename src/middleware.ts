import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export async function middleware(request: NextRequest) {
  const requestId = request.headers.get("x-request-id")?.slice(0, 128) || crypto.randomUUID();
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set("x-request-id", requestId);
  let response = NextResponse.next({ request: { headers: forwardedHeaders } });

  // If Supabase isn't configured yet (or env still has placeholders), let
  // everything through so the public site works in sample-data mode.
  if (!/^https?:\/\/.+\..+/.test(SUPABASE_URL) || SUPABASE_ANON_KEY.length <= 20) {
    response.headers.set("x-request-id", requestId);
    return response;
  }

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: forwardedHeaders } });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Refresh the session (also writes refreshed cookies onto `response`).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Protect the dashboard.
  if (!user && request.nextUrl.pathname.startsWith("/dashboard")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("signin", "required");
    const redirect = NextResponse.redirect(url);
    redirect.headers.set("x-request-id", requestId);
    return redirect;
  }

  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: [
    // Run on everything except static assets & images.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
