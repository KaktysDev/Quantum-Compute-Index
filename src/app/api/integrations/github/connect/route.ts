import { NextResponse } from "next/server";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { createGithubInstallationState, githubAppConfigured } from "@/lib/qrouter/github";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  try {
    const principal = await resolvePrincipal(request);
    if (!githubAppConfigured()) return NextResponse.redirect(new URL("/dashboard/github?error=github_app_not_configured", origin));
    const state = createGithubInstallationState(principal);
    const slug = process.env.GITHUB_APP_SLUG!;
    return NextResponse.redirect(`https://github.com/apps/${encodeURIComponent(slug)}/installations/new?state=${encodeURIComponent(state)}`);
  } catch {
    return NextResponse.redirect(new URL("/dashboard/github?error=github_connection_failed", origin));
  }
}
