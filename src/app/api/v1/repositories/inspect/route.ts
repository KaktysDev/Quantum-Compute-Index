import { NextResponse } from "next/server";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { getGithubAccessToken } from "@/lib/qrouter/github";
import { apiError } from "@/lib/qrouter/http";
import { inspectRepository } from "@/lib/qrouter/repositories";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    const url = new URL(request.url);
    const repository = url.searchParams.get("repository") ?? "";
    const ref = url.searchParams.get("ref") || undefined;
    return NextResponse.json(await inspectRepository(repository, ref, await getGithubAccessToken(principal)));
  } catch (error) {
    return apiError(error);
  }
}
