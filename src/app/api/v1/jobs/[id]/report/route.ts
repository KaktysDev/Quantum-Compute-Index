import { NextResponse } from "next/server";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { apiError } from "@/lib/qrouter/http";
import { assembleJobReport, notFound } from "@/lib/qrouter/report";
import { requireScope } from "@/lib/qrouter/scopes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await resolvePrincipal(request);
    requireScope(principal, "jobs:read");
    const { id } = await params;
    const assembled = await assembleJobReport({ principal, jobId: id, signal: request.signal, withNarrative: true });
    if (!assembled) return NextResponse.json(notFound(), { status: 404 });
    return NextResponse.json(assembled.context);
  } catch (error) {
    return apiError(error);
  }
}
