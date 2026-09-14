import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeAssistantQuota, recordAssistantTokens } from "@/lib/ai/limits";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { apiError } from "@/lib/qrouter/http";
import { answerReportQuestion, assembleJobReport, notFound, QUESTION_MAX } from "@/lib/qrouter/report";
import { requireScope } from "@/lib/qrouter/scopes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const askSchema = z.object({
  question: z.string().trim().min(1).max(QUESTION_MAX),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await resolvePrincipal(request);
    requireScope(principal, "jobs:read");
    const quota = await consumeAssistantQuota(principal);
    if (!quota.allowed) {
      return NextResponse.json(
        { error: { type: "rate_limit_error", message: `Assistant quota exceeded. Try again in ${quota.resetMinutes} min.` } },
        { status: 429 },
      );
    }
    const parsed = askSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: { type: "invalid_request", message: "Ask a question about this job's stored results." } }, { status: 400 });
    }
    const { id } = await params;
    const assembled = await assembleJobReport({ principal, jobId: id, signal: request.signal, withNarrative: true });
    if (!assembled) return NextResponse.json(notFound(), { status: 404 });
    const replied = await answerReportQuestion({
      context: assembled.context,
      cacheKey: assembled.cacheKey,
      question: parsed.data.question,
      signal: request.signal,
    });
    await recordAssistantTokens(principal, Math.ceil((parsed.data.question.length + replied.answer.length) / 4));
    return NextResponse.json({
      job_id: assembled.job.id,
      result_hash: assembled.context.hash,
      question: parsed.data.question,
      answer: replied.answer,
      source: replied.source,
    });
  } catch (error) {
    return apiError(error);
  }
}
