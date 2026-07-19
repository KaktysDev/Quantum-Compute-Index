// Resolve a repository-referenced circuit into OpenQASM text for the chat's
// job-confirmation card (which then quotes and submits via the normal jobs
// API). Auth-gated like every other console endpoint.

import { NextResponse } from "next/server";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { getGithubAccessToken } from "@/lib/qrouter/github";
import { apiError } from "@/lib/qrouter/http";
import { readCircuitFromRepository } from "@/lib/qrouter/repositories";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    const url = new URL(request.url);
    const repository = url.searchParams.get("repository") ?? "";
    const ref = url.searchParams.get("ref") || "";
    const path = url.searchParams.get("path") ?? "";
    if (!repository || !path) {
      return NextResponse.json(
        { error: { message: "repository and path are required." } },
        { status: 400 },
      );
    }
    const token = await getGithubAccessToken(principal);
    const source = await readCircuitFromRepository(repository, ref || "HEAD", path, token);
    const format = /OPENQASM\s+3/i.test(source.text) ? "openqasm3" : "openqasm2";
    return NextResponse.json({ circuit: source.text, format, path: source.path });
  } catch (error) {
    return apiError(error);
  }
}
