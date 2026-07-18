import { createHash, randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { QpuComponent } from "@/lib/qci/types";
import { getLatestSnapshot } from "@/lib/qci/store";
import { analyzeCircuit } from "@/lib/qrouter/analyze";
import { storeArtifact } from "@/lib/qrouter/artifacts";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { withQciSnapshot } from "@/lib/qrouter/catalog";
import { demoJobs, type StoredJob } from "@/lib/qrouter/demo-store";
import { submitToProvider } from "@/lib/qrouter/execution";
import { apiError } from "@/lib/qrouter/http";
import { prepareExecution } from "@/lib/qrouter/pipeline";
import { applyProviderHealth, loadPersistedBackendHealth } from "@/lib/qrouter/providerHealth";
import { publicTranspilation } from "@/lib/qrouter/transpiler";
import { createJobSchema } from "@/lib/qrouter/validation";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    if (principal.demo) {
      const data = [...demoJobs.values()].filter((job) => job.organization_id === principal.organizationId).sort((a, b) => b.created_at.localeCompare(a.created_at));
      return NextResponse.json({ object: "list", data });
    }
    const admin = createAdminClient();
    const { data, error } = await admin.from("jobs").select("id,project_id,request_id,name,input_format,shots,target,routing_mode,status,selected_backend_id,failover_enabled,max_attempts,execution_deadline_at,analysis,route_decision,result,error,created_at,updated_at,completed_at").eq("organization_id", principal.organizationId).order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    return NextResponse.json({ object: "list", data });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    const parsed = createJobSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: { type: "invalid_request", message: "The request body is invalid.", details: parsed.error.flatten() } }, { status: 400 });
    }
    const input = parsed.data;
    const originalAnalysis = analyzeCircuit(input.circuit, input.format);
    let snapshot: { id: number | null; ts: string; components: QpuComponent[] };
    if (principal.demo) {
      const latest = await getLatestSnapshot();
      snapshot = { id: null, ts: latest.ts, components: latest.components };
    } else {
      const { data } = await createAdminClient()
        .from("qci_snapshots")
        .select("id,ts,components")
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle();
      snapshot = {
        id: data?.id ?? null,
        ts: data?.ts ?? new Date().toISOString(),
        components: (data?.components ?? []) as QpuComponent[],
      };
    }
    const backendHealth = principal.demo ? [] : await loadPersistedBackendHealth();
    const prepared = await prepareExecution({
      backends: applyProviderHealth(withQciSnapshot(snapshot.components), backendHealth),
      analysis: originalAnalysis,
      shots: input.shots,
      target: input.target,
      mode: input.routing_mode,
      constraints: input.constraints,
      qciSnapshotId: snapshot.id,
      qciTimestamp: snapshot.ts,
      optimizationLevel: input.optimization_level,
    });
    const { decision, quote, executionAnalysis } = prepared;
    const analysis = { ...originalAnalysis, transpilation: publicTranspilation(prepared.transpilation) };
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() || null;
    const requestId = request.headers.get("x-request-id")?.trim() || randomUUID();
    const now = new Date().toISOString();
    const jobId = randomUUID();

    if (principal.demo) {
      if (idempotencyKey) {
        const existing = [...demoJobs.values()].find((job) => job.organization_id === principal.organizationId && (job as StoredJob & { idempotency_key?: string }).idempotency_key === idempotencyKey);
        if (existing) return NextResponse.json(existing);
      }
      const base: StoredJob & { idempotency_key?: string } = {
        id: jobId, organization_id: principal.organizationId, name: input.name ?? null,
        input_format: input.format, source: input.circuit, shots: input.shots, target: input.target,
        routing_mode: input.routing_mode, status: "submitted", selected_backend_id: decision.selected.id,
        analysis, route_decision: decision, quote, result: null, error: null,
        created_at: now, updated_at: now, completed_at: null, idempotency_key: idempotencyKey ?? undefined,
      };
      demoJobs.set(jobId, base);
      try {
        const submission = await submitToProvider(decision.selected.id, executionAnalysis, input.shots, jobId);
        base.status = submission.status === "completed" ? "completed" : "submitted";
        base.result = submission.result ?? null;
        base.updated_at = new Date().toISOString();
        base.completed_at = submission.status === "completed" ? base.updated_at : null;
      } catch (error) {
        base.status = "failed";
        base.error = { message: error instanceof Error ? error.message : "Execution failed." };
      }
      return NextResponse.json(base, { status: 201 });
    }

    const admin = createAdminClient();
    if (idempotencyKey) {
      const { data: existing } = await admin.from("jobs").select("*").eq("organization_id", principal.organizationId).eq("idempotency_key", idempotencyKey).maybeSingle();
      if (existing) return NextResponse.json(existing);
    }
    const sourceHash = createHash("sha256").update(input.circuit).digest("hex");
    const { error: jobError } = await admin.from("jobs").insert({
      id: jobId, organization_id: principal.organizationId, user_id: principal.userId,
      api_key_id: principal.apiKeyId, idempotency_key: idempotencyKey, name: input.name,
      request_id: requestId,
      input_format: input.format, source: input.circuit, source_hash: sourceHash, shots: input.shots,
      target: input.target, routing_mode: input.routing_mode, constraints: input.constraints,
      analysis, route_decision: decision, selected_backend_id: decision.selected.id, status: "quoted",
      failover_enabled: input.failover, max_attempts: input.max_attempts, execution_timeout_seconds: input.timeout_seconds, next_attempt_at: now,
    });
    if (jobError) throw jobError;
    await Promise.all([
      storeArtifact({ jobId, organizationId: principal.organizationId, kind: "source", content: input.circuit }),
      storeArtifact({
        jobId,
        organizationId: principal.organizationId,
        kind: "transpiled",
        content: prepared.transpilation.artifactQasm ?? prepared.transpilation.qasm,
      }),
    ]);
    const { data: quoteRow, error: quoteError } = await admin.from("quotes").insert({
      job_id: jobId, organization_id: principal.organizationId, provider_cost: quote.providerCost,
      transpiler_fee: quote.transpilerFee, platform_fee: quote.platformFee, total: quote.total,
      rate_snapshot: quote.rateSnapshot, expires_at: quote.expiresAt,
    }).select("id").single();
    if (quoteError) throw quoteError;
    await admin.from("jobs").update({ quote_id: quoteRow.id, status: "funds_reserved", updated_at: new Date().toISOString() }).eq("id", jobId);
    const { error: reserveError } = await admin.rpc("reserve_job_credits", { p_job_id: jobId, p_amount: quote.total });
    if (reserveError) {
      await admin.from("jobs").update({ status: "awaiting_payment", error: { message: "Add credits before running this task." } }).eq("id", jobId);
      return NextResponse.json({ error: { type: "insufficient_credits", message: "Add credits before running this task.", quote, job_id: jobId } }, { status: 402 });
    }
    await admin.from("job_events").insert({ job_id: jobId, type: "credits.reserved", from_status: "quoted", to_status: "funds_reserved", payload: { amount: quote.total } });
    await admin.from("jobs").update({ status: "queued", next_attempt_at: now, updated_at: new Date().toISOString() }).eq("id", jobId);
    await admin.from("job_events").insert({ job_id: jobId, type: "job.queued", from_status: "funds_reserved", to_status: "queued", payload: { failover: input.failover, maxAttempts: input.max_attempts, requestId } });
    const { data: created, error } = await admin.from("jobs").select("*").eq("id", jobId).single();
    if (error) throw error;
    return NextResponse.json({ ...created, quote }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
