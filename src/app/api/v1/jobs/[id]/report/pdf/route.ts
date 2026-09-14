import { NextResponse } from "next/server";
import { RateLimitError, resolvePrincipal } from "@/lib/qrouter/auth";
import { apiError } from "@/lib/qrouter/http";
import { assembleJobReport, buildReportPdf, getCachedPdf, notFound, pdfFileName, setCachedPdf } from "@/lib/qrouter/report";
import { requireScope } from "@/lib/qrouter/scopes";
import { consumeRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PDF_MAX_BYTES = 2_000_000;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await resolvePrincipal(request);
    requireScope(principal, "jobs:read");
    const limited = await consumeRateLimit(`report-pdf:${principal.organizationId}`, 20, 60);
    if (!limited.allowed) throw new RateLimitError("Report download rate limit exceeded. Retry shortly.", limited.retryAfterSeconds);
    const { id } = await params;
    const assembled = await assembleJobReport({ principal, jobId: id, signal: request.signal, withNarrative: true });
    if (!assembled) return NextResponse.json(notFound(), { status: 404 });
    const cached = getCachedPdf(assembled.cacheKey);
    const bytes = cached?.bytes ?? setCachedPdf(assembled.cacheKey, buildReportPdf(assembled.context)).bytes;
    if (bytes.byteLength > PDF_MAX_BYTES) {
      return NextResponse.json({ error: { type: "payload_too_large", message: "The report PDF exceeded the size cap." } }, { status: 413 });
    }
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${pdfFileName(String(assembled.job.id))}"`,
        "cache-control": "private, max-age=60",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
