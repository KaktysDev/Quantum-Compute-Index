import { createHash, randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { QpuComponent } from "@/lib/qci/types";
import { getLatestSnapshot } from "@/lib/qci/store";
import { createAdminClient } from "@/lib/supabase/admin";
import { analyzeCircuit } from "@/lib/qrouter/analyze";
import { storeArtifact } from "@/lib/qrouter/artifacts";
import { resolvePrincipal, type Principal } from "@/lib/qrouter/auth";
import { withQciSnapshot } from "@/lib/qrouter/catalog";
import { demoJobs, type StoredJob } from "@/lib/qrouter/demo-store";
import { submitToProvider } from "@/lib/qrouter/execution";
import { apiError } from "@/lib/qrouter/http";
import { prepareExecution } from "@/lib/qrouter/pipeline";
import { createJobSchema } from "@/lib/qrouter/validation";
import { publicTranspilation } from "@/lib/qrouter/transpiler";
import { dispatchJobWebhook } from "@/lib/qrouter/webhooks";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function loadPricingSnapshot(principal: Principal) {
  if (principal.demo) {
    const snapshot = await getLatestSnapshot();
    return { id: null, ts: snapshot.ts, components: snapshot.components };
  }
  const { data } = await createAdminClient()
    .from("qci_snapshots")
    .select("id,ts,components")
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    id: data?.id ?? null,
    ts: data?.ts ?? new Date().toISOString(),
    components: (data?.components ?? []) as QpuComponent[],
  };
}

export async function GET(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    if (principal.demo) {
      return NextResponse.json({
        object: "list",
        data: [...demoJobs.values()]
          .filter((job) => job.organization_id === principal.organizationId)
          .sort((a, b) => b.created_at.localeCompare(a.created_at)),
      });
    }
    const { data, error } = await createAdminClient()
      .from("jobs")
      .select("id,name,input_format,shots,target,routing_mode,status,selected_backend_id,analysis,route_decision,result,error,created_at,updated_at,completed_at")
      .eq("organization_id", principal.organizationId)
      .order("created_at", { ascending: false })
      .limit(100);
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
      return NextResponse.json(
        { error: { type: "invalid_request", message: "The request body is invalid.", details: parsed.error.flatten() } },
        { status: 400 },
      );
    }

    const input = parsed.data;
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() || null;
    if (idempotencyKey && principal.demo) {
      const existing = [...demoJobs.values()].find(
        (job) => job.organization_id === principal.organizationId && job.idempotency_key === idempotencyKey,
      );
      if (existing) return NextResponse.json(existing);
    }
    const admin = principal.demo ? null : createAdminClient();
    if (idempotencyKey && admin) {
      const { data: existing } = await admin
        .from("jobs")
        .select("*")
        .eq("organization_id", principal.organizationId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existing) return NextResponse.json(existing);
    }
    const originalAnalysis = analyzeCircuit(input.circuit, input.format);
    const snapshot = await loadPricingSnapshot(principal);
    const prepared = await prepareExecution({
      backends: withQciSnapshot(snapshot.components),
      analysis: originalAnalysis,
      shots: input.shots,
      target: input.target,
      mode: input.routing_mode,
      constraints: input.constraints,
      qciSnapshotId: snapshot.id,
      qciTimestamp: snapshot.ts,
      optimizationLevel: input.optimization_level,
    });
    const { decision, quote, transpilation, executionAnalysis } = prepared;
    const redactedTranspilation = publicTranspilation(transpilation);
    const storedAnalysis = { ...executionAnalysis, original: originalAnalysis, transpilation: redactedTranspilation };
    const now = new Date().toISOString();
    const jobId = randomUUID();

    if (principal.demo) {
      const job: StoredJob = {
        id: jobId,
        organization_id: principal.organizationId,
        name: input.name ?? null,
        input_format: input.format,
        source: input.circuit,
        shots: input.shots,
        target: input.target,
        routing_mode: input.routing_mode,
        status: "submitted",
        selected_backend_id: decision.selected.id,
        analysis: storedAnalysis,
        route_decision: decision,
        quote,
        result: null,
        error: null,
        created_at: now,
        updated_at: now,
        completed_at: null,
        idempotency_key: idempotencyKey ?? undefined,
      };
      demoJobs.set(jobId, job);
      try {
        const submission = await submitToProvider(decision.selected.id, executionAnalysis, input.shots, jobId, transpilation);
        job.provider_job_id = submission.providerJobId;
        job.status = submission.status === "completed" ? "completed" : "submitted";
        job.result = submission.result ?? null;
        job.updated_at = new Date().toISOString();
        job.completed_at = job.status === "completed" ? job.updated_at : null;
      } catch (error) {
        job.status = "failed";
        job.error = { message: error instanceof Error ? error.message : "Execution failed." };
      }
      return NextResponse.json(job, { status: 201 });
    }

    if (!admin) throw new Error("Database client is unavailable.");
    if (decision.selected.kind === "qpu") {
      const { data: organization } = await admin
        .from("organizations")
        .select("billing_setup_complete")
        .eq("id", principal.organizationId)
        .single();
      if (!organization?.billing_setup_complete) {
        return NextResponse.json(
          { error: { type: "billing_required", message: "Connect a payment method before running a physical QPU.", quote } },
          { status: 402 },
        );
      }
    }
    const { error: jobError } = await admin.from("jobs").insert({
      id: jobId,
      organization_id: principal.organizationId,
      user_id: principal.userId,
      api_key_id: principal.apiKeyId,
      idempotency_key: idempotencyKey,
      name: input.name,
      input_format: input.format,
      source: input.circuit,
      source_hash: createHash("sha256").update(input.circuit).digest("hex"),
      shots: input.shots,
      target: input.target,
      routing_mode: input.routing_mode,
      constraints: input.constraints,
      analysis: storedAnalysis,
      route_decision: decision,
      selected_backend_id: decision.selected.id,
      status: "quoted",
    });
    if (jobError) throw jobError;
    await Promise.all([
      storeArtifact({ jobId, organizationId: principal.organizationId, kind: "source", content: input.circuit }),
      storeArtifact({ jobId, organizationId: principal.organizationId, kind: "transpiled", content: transpilation.artifactQasm ?? transpilation.qasm }),
    ]);
    const { error: quoteError } = await admin.from("quotes").insert({
      job_id: jobId,
      organization_id: principal.organizationId,
      provider_cost: quote.providerCost,
      transpiler_fee: quote.transpilerFee,
      platform_fee: quote.platformFee,
      total: quote.total,
      qci_snapshot_id: snapshot.id,
      rate_snapshot: quote.rateSnapshot,
      expires_at: quote.expiresAt,
    });
    if (quoteError) throw quoteError;
    const { error: reserveError } = await admin.rpc("reserve_job_credits", {
      p_job_id: jobId,
      p_amount: quote.total,
    });
    if (reserveError) {
      await admin.from("jobs").update({ status: "awaiting_payment", error: { message: "Add credits before running this task." } }).eq("id", jobId);
      return NextResponse.json(
        { error: { type: "insufficient_credits", message: "Add credits before running this task.", quote, job_id: jobId } },
        { status: 402 },
      );
    }
    await admin.from("jobs").update({ status: "funds_reserved" }).eq("id", jobId);
    await admin.from("job_events").insert([
      { job_id: jobId, type: "job.transpiled", from_status: "analyzing", to_status: "quoted", payload: redactedTranspilation },
      { job_id: jobId, type: "credits.reserved", from_status: "quoted", to_status: "funds_reserved", payload: { amount: quote.total } },
    ]);

    try {
      const submission = await submitToProvider(decision.selected.id, executionAnalysis, input.shots, jobId, transpilation);
      const status = submission.status === "completed" ? "completed" : "submitted";
      const completedAt = status === "completed" ? new Date().toISOString() : null;
      if (status === "completed" && submission.result) {
        await storeArtifact({
          jobId,
          organizationId: principal.organizationId,
          kind: "result",
          content: JSON.stringify(submission.result),
        });
      }
      await admin.from("jobs").update({
        status,
        provider_job_id: submission.providerJobId,
        result: submission.result ? { available: true, encrypted: true } : null,
        started_at: now,
        completed_at: completedAt,
        updated_at: new Date().toISOString(),
      }).eq("id", jobId);
      await admin.from("job_attempts").insert({
        job_id: jobId,
        attempt: 1,
        backend_id: decision.selected.id,
        provider_job_id: submission.providerJobId,
        status,
        request: { shots: input.shots, transpiledQasmHash: createHash("sha256").update(transpilation.qasm).digest("hex") },
        response: submission.result ?? {},
        finished_at: completedAt,
      });
      await admin.from("job_events").insert({
        job_id: jobId,
        type: `job.${status}`,
        from_status: "funds_reserved",
        to_status: status,
        payload: { providerJobId: submission.providerJobId },
      });
      if (status === "completed") {
        await admin.rpc("settle_job_credits", { p_job_id: jobId, p_reserved: quote.total, p_actual: quote.total });
        await dispatchJobWebhook(jobId, "job.completed");
      }
    } catch (error) {
      await admin.from("jobs").update({
        status: "failed",
        error: { message: error instanceof Error ? error.message : "Provider submission failed." },
        completed_at: new Date().toISOString(),
      }).eq("id", jobId);
      await admin.rpc("release_job_credits", { p_job_id: jobId, p_amount: quote.total });
      throw error;
    }

    const { data: created, error } = await admin.from("jobs").select("*").eq("id", jobId).single();
    if (error) throw error;
    return NextResponse.json({ ...created, result: created.status === "completed" ? created.result : null, quote }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
