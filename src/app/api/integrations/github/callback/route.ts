import { NextResponse } from "next/server";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { readGithubInstallation, verifyGithubInstallationState } from "@/lib/qrouter/github";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const destination = new URL("/dashboard/github", url.origin);
  try {
    const principal = await resolvePrincipal(request);
    const state = url.searchParams.get("state") ?? "";
    const installationId = Number(url.searchParams.get("installation_id"));
    if (principal.demo || !verifyGithubInstallationState(state, principal) || !Number.isSafeInteger(installationId) || installationId <= 0) {
      throw new Error("Invalid GitHub installation callback.");
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
