import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { demoJobs } from "@/lib/qrouter/demo-store";
import { apiError } from "@/lib/qrouter/http";
import { requireScope } from "@/lib/qrouter/scopes";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const schema = z.object({
  messageId: z.number().int().positive(),
  idempotencyKey: z.string().min(1).max(200),
  name: z.string().trim().max(120).optional(),
  circuit: z.string().min(1).max(256_000),
  shots: z.number().int().min(1).max(1_000_000),
  target: z.string().min(1).max(200),
  routing_mode: z.enum(["balanced", "cost", "speed", "quality"]),
});

const JOB_SELECT = "id,status,selected_backend_id,result,idempotency_key,created_at,quotes!job_id(total)";

function responseJob(job: Record<string, unknown>) {
  const quotes = job.quotes as Array<{ total?: number }> | { total?: number } | null | undefined;
  const quote = Array.isArray(quotes) ? quotes[0] : quotes;
  return {
    id: String(job.id),
    status: String(job.status),
    selected_backend_id: String(job.selected_backend_id ?? "unknown"),
    result: job.result ?? null,
    quote: typeof quote?.total === "number" ? { total: quote.total } : null,
  };
}

/**
 * Restore a confirmation card after chat navigation.
 *
 * New cards use a stable, message-scoped idempotency key. The source/parameter
 * lookup is a compatibility bridge for jobs confirmed before that key existed:
 * only jobs created after this exact assistant message are eligible.
 */
export async function POST(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    requireScope(principal, "jobs:read");
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: { message: "The proposal status request is invalid." } }, { status: 400 });
    }
    const input = parsed.data;

    if (principal.demo) {
      const job = [...demoJobs.values()].find(
        (candidate) => candidate.organization_id === principal.organizationId &&
          (candidate as typeof candidate & { idempotency_key?: string }).idempotency_key === input.idempotencyKey,
      );
      return job
        ? NextResponse.json(responseJob(job as unknown as Record<string, unknown>))
        : NextResponse.json({ error: { message: "No prior run was found." } }, { status: 404 });
    }

    const admin = createAdminClient();
    const { data: message, error: messageError } = await admin
      .from("chat_messages")
      .select("id,thread_id,created_at")
      .eq("id", input.messageId)
      .eq("role", "assistant")
      .maybeSingle();
    if (messageError) throw messageError;
    if (!message) return NextResponse.json({ error: { message: "Chat message not found." } }, { status: 404 });

    const { data: thread, error: threadError } = await admin
      .from("chat_threads")
      .select("id")
      .eq("id", message.thread_id)
      .eq("organization_id", principal.organizationId)
      .maybeSingle();
    if (threadError) throw threadError;
    if (!thread) return NextResponse.json({ error: { message: "Chat message not found." } }, { status: 404 });

    const { data: exact, error: exactError } = await admin
      .from("jobs")
      .select(JOB_SELECT)
      .eq("organization_id", principal.organizationId)
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle();
    if (exactError) throw exactError;
    if (exact) return NextResponse.json(responseJob(exact as unknown as Record<string, unknown>));

    // Legacy runs used a random key. Source + execution parameters + temporal
    // ordering provide a narrow migration match without making an earlier run
    // satisfy a newly-created proposal message.
    const sourceHash = createHash("sha256").update(input.circuit).digest("hex");
    let legacyQuery = admin
      .from("jobs")
      .select(JOB_SELECT)
      .eq("organization_id", principal.organizationId)
      .eq("source_hash", sourceHash)
      .eq("shots", input.shots)
      .eq("target", input.target)
      .eq("routing_mode", input.routing_mode)
      .gte("created_at", message.created_at)
      .order("created_at", { ascending: true })
      .limit(10);
    if (input.name) legacyQuery = legacyQuery.eq("name", input.name);
    const { data: legacy, error: legacyError } = await legacyQuery;
    if (legacyError) throw legacyError;
    const prior = (legacy ?? []).find((job) => !["failed", "cancelled"].includes(String(job.status)));
    return prior
      ? NextResponse.json(responseJob(prior as unknown as Record<string, unknown>))
      : NextResponse.json({ error: { message: "No prior run was found." } }, { status: 404 });
  } catch (error) {
    return apiError(error);
  }
}
