import { NextResponse } from "next/server";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { getGithubAccess } from "@/lib/qrouter/github";
import { apiError } from "@/lib/qrouter/http";
import { inspectRepository } from "@/lib/qrouter/repositories";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    const url = new URL(request.url);
    const repository = url.searchParams.get("repository") ?? "";
    const ref = url.searchParams.get("ref") || undefined;
    const access = await getGithubAccess(principal);
    return NextResponse.json(await inspectRepository(repository, ref, { token: access.token, allowPrivate: access.allowPrivate }));
  } catch (error) {
    return apiError(error);
  }
}
