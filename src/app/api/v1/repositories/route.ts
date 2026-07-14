import { NextResponse } from "next/server";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { githubAppConfigured, listGithubRepositories } from "@/lib/qrouter/github";
import { apiError } from "@/lib/qrouter/http";

export const dynamic = "force-dynamic";

/** GET: repositories the caller can import (App installation repos, or the
 *  personal GITHUB_TOKEN's repos as a local fallback). Powers the import picker. */
export async function GET(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    const data = await listGithubRepositories(principal);
    const hasToken = Boolean(process.env.GITHUB_TOKEN || process.env.GITHUB_APP_TOKEN);
    return NextResponse.json({
      object: "list",
      // Whether any repo source is wired up at all (App or personal token).
      source: githubAppConfigured() ? "app" : hasToken ? "token" : "none",
      data,
    });
  } catch (error) {
    return apiError(error);
  }
}
