import { NextResponse } from "next/server";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { readGithubInstallation, verifyGithubInstallationState, verifyInstallationOwnership } from "@/lib/qrouter/github";
import { createAdminClient } from "@/lib/supabase/admin";

const oauthConfigured = () => Boolean(process.env.GITHUB_APP_CLIENT_ID && process.env.GITHUB_APP_CLIENT_SECRET);
const isProduction = () => process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const destination = new URL("/dashboard/github", url.origin);
  try {
    const principal = await resolvePrincipal(request);
    const state = url.searchParams.get("state") ?? "";
    const installationId = Number(url.searchParams.get("installation_id"));
    const setupAction = url.searchParams.get("setup_action") ?? "install";
    if (
      principal.demo
      || !verifyGithubInstallationState(state, principal)
      || !Number.isSafeInteger(installationId)
      || installationId <= 0
      || !["install", "update"].includes(setupAction)
    ) {
      throw new Error("Invalid GitHub installation callback.");
    }

    // Bind the installation only when the caller proves they control it. The
    // App's "Request user authorization (OAuth) during installation" setting
    // sends a `code`; exchanging it lets us check the user's installations.
    // Without OAuth credentials this proof is impossible, so production fails
    // closed rather than letting any tenant claim an arbitrary installation_id.
    if (oauthConfigured()) {
      const code = url.searchParams.get("code");
      if (!code || !(await verifyInstallationOwnership(code, installationId))) {
        throw new Error("GitHub installation ownership could not be verified.");
      }
    } else if (isProduction()) {
      throw new Error("GITHUB_APP_CLIENT_ID/GITHUB_APP_CLIENT_SECRET are required to verify installations in production.");
    }

    const installation = await readGithubInstallation(installationId);
    const { error } = await createAdminClient().from("github_connections").upsert({
      organization_id: principal.organizationId,
      installation_id: installation.id,
      account_login: installation.account.login,
      account_type: installation.account.type,
      updated_at: new Date().toISOString(),
    }, { onConflict: "organization_id" });
    if (error) throw error;
    destination.searchParams.set("connected", "github");
  } catch {
    destination.searchParams.set("error", "github_connection_failed");
  }
  return NextResponse.redirect(destination);
}
