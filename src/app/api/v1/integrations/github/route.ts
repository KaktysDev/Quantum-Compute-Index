import { NextResponse } from "next/server";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { getGithubConnection, githubAppConfigured } from "@/lib/qrouter/github";
import { apiError } from "@/lib/qrouter/http";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    const connection = await getGithubConnection(principal);
    return NextResponse.json({
      configured: githubAppConfigured(),
      connected: Boolean(connection || (principal.demo && (process.env.GITHUB_TOKEN || process.env.GITHUB_APP_TOKEN))),
      connection,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    if (principal.demo) return new NextResponse(null, { status: 204 });
    const { error } = await createAdminClient().from("github_connections").delete().eq("organization_id", principal.organizationId);
    if (error) throw error;
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
