import { createHash } from "crypto";
import { analyzeCircuit, CircuitValidationError } from "./analyze";
import { deleteJobArtifacts, storeArtifact, loadArtifact } from "./artifacts";
import { mapWithConcurrency } from "./concurrency";
import { demoJobs, type StoredJob } from "./demo-store";
import { submitToProvider } from "./execution";
import { cancelProviderJob } from "./execution";
import { prepareExecution } from "./pipeline";
import { loadRoutingContext } from "./routingContext";
import { assertTargetAllowedV2, backendsForPrincipal } from "./scopes";
import { publicTranspilation } from "./transpiler";
import type { InputFormat } from "./types";
import { normalizeProviderResult } from "./results";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Principal } from "./auth";
import { V2ApiError } from "./v2-http";
import { demoV2Circuits, demoV2Groups, type DemoCircuit, type DemoGroup } from "./v2-demo-store";
import { hashRequest, newV2Id, type CircuitResource, type CreateCircuitInput, type CreateExecutionGroupInput, type ExecutionGroup, type V2GroupStatus } from "./v2";

type DbRow = Record<string, unknown>;
type PreparedExecution = Awaited<ReturnType<typeof prepareExecution>> & CreateExecutionGroupInput["executions"][number];

const ACTIVE_EXECUTION_STATUSES = ["created", "analyzing", "quoted", "funds_reserved", "queued", "dispatching", "submitted", "processing", "cancellation_requested"];

/** Simultaneous remote transpiles / artifact uploads per execution group. */
const EXECUTION_FANOUT_LIMIT = Number(process.env.QROUTER_EXECUTION_CONCURRENCY ?? 4);

/** Mirrors the group rollup in finalize_qrouter_job so demo and SQL agree. */
function groupStatusFrom(statuses: string[]): V2GroupStatus {
  if (statuses.some((status) => ACTIVE_EXECUTION_STATUSES.includes(status))) return "running";
  if (statuses.includes("awaiting_payment")) return "awaiting_payment";
  if (statuses.includes("completed")) return "completed";
  if (statuses.includes("failed")) return "failed";
  return "cancelled";
}

function groupResource(group: DemoGroup): ExecutionGroup {
  return {
    id: group.id, circuit_id: group.circuit_id, organization_id: group.organization_id, status: group.status,
    metadata: group.metadata, executions: group.executions, created_at: group.created_at,
    updated_at: group.updated_at, completed_at: group.completed_at, error: group.error,
  };
}

/**
 * Keeps the derived metrics (qubits, depth, gate counts) and drops the keys
 * that are the circuit itself. Mirrors the jsonb subtraction in
 * purge_circuit_data so demo and SQL purge to the same shape.
 */
function releasedAnalysis(analysis: unknown): Record<string, unknown> {
  const source = (analysis ?? {}) as Record<string, unknown>;
  const kept = Object.fromEntries(Object.entries(source).filter(([key]) => key !== "normalizedQasm2" && key !== "transpilation" && key !== "encoding"));
  return { ...kept, released: true };
}

function releasedRouteDecision(decision: unknown): unknown {
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) return decision;
  const row = { ...(decision as Record<string, unknown>) };
  if (!row.encoding || typeof row.encoding !== "object" || Array.isArray(row.encoding)) return row;
  const encoding = { ...(row.encoding as Record<string, unknown>) };
  if (encoding.selected_bundle && typeof encoding.selected_bundle === "object" && !Array.isArray(encoding.selected_bundle)) {
    const bundle = { ...(encoding.selected_bundle as Record<string, unknown>) };
    delete bundle.payload;
    encoding.selected_bundle = bundle;
  }
  row.encoding = encoding;
  return row;
}

function circuitResource(row: DbRow): CircuitResource {
  return {
    id: String(row.id), organization_id: String(row.organization_id), name: row.name == null ? null : String(row.name),
    format: (row.input_format ?? row.format) === "openqasm3" ? "openqasm3" : "openqasm2", source_hash: String(row.source_hash),
    analysis: (row.analysis ?? {}) as Record<string, unknown>, created_at: String(row.created_at),
    expires_at: row.expires_at == null ? null : String(row.expires_at), released_at: row.released_at == null ? null : String(row.released_at),
  };
}

function executionSummary(row: DbRow, quote?: DbRow) {
  return {
    id: row.id, key: row.execution_key, status: row.status, target: row.target, selected_backend_id: row.selected_backend_id,
    shots: row.shots, routing_mode: row.routing_mode, analysis: row.analysis, route_decision: row.route_decision,
    error: row.error, result_available: row.status === "completed", created_at: row.created_at,
    updated_at: row.updated_at, completed_at: row.completed_at,
    ...(quote ? { quote } : {}),
  };
}

async function existingCircuit(principal: Principal, idempotencyKey: string, requestHash: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("circuits").select("*").eq("organization_id", principal.organizationId).eq("idempotency_key", idempotencyKey).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (data.request_hash !== requestHash) throw new V2ApiError(409, "idempotency_conflict", "Idempotency key was already used for a different circuit.");
  return data as DbRow;
}

async function existingGroup(principal: Principal, idempotencyKey: string, requestHash: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("execution_groups").select("*").eq("organization_id", principal.organizationId).eq("idempotency_key", idempotencyKey).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (data.request_hash !== requestHash) throw new V2ApiError(409, "idempotency_conflict", "Idempotency key was already used for a different job.");
  return data as DbRow;
}

export async function createCircuitResource(principal: Principal, input: CreateCircuitInput, idempotencyKey: string) {
  let analysis;
  try {
    analysis = analyzeCircuit(input.circuit, input.format);
  } catch (error) {
    if (error instanceof CircuitValidationError) throw new V2ApiError(422, "invalid_circuit", error.message);
    throw error;
  }
  const requestHash = hashRequest({ name: input.name ?? null, circuit: input.circuit, format: input.format });
  if (principal.demo) {
    const existing = [...demoV2Circuits.values()].find((circuit) => circuit.organization_id === principal.organizationId && circuit.idempotency_key === idempotencyKey);
    if (existing) {
      if (existing.request_hash !== requestHash) throw new V2ApiError(409, "idempotency_conflict", "Idempotency key was already used for a different circuit.");
      return { circuit: circuitResource(existing as unknown as DbRow), replayed: true };
    }
    const now = new Date().toISOString();
    const circuit: DemoCircuit = {
      id: newV2Id(), organization_id: principal.organizationId, name: input.name ?? null, format: input.format,
      source: input.circuit, source_hash: createHash("sha256").update(input.circuit).digest("hex"), analysis: analysis as unknown as Record<string, unknown>,
      created_at: now, expires_at: null, released_at: null, idempotency_key: idempotencyKey, request_hash: requestHash,
    };
    demoV2Circuits.set(circuit.id, circuit);
    return { circuit: circuitResource(circuit as unknown as DbRow), replayed: false };
  }

  const replay = await existingCircuit(principal, idempotencyKey, requestHash);
  if (replay) return { circuit: circuitResource(replay), replayed: true };
  const id = newV2Id();
  const now = new Date().toISOString();
  const row = {
    id, organization_id: principal.organizationId, user_id: principal.userId, api_key_id: principal.apiKeyId,
    name: input.name ?? null, input_format: input.format, source: input.circuit,
    source_hash: createHash("sha256").update(input.circuit).digest("hex"), analysis,
    idempotency_key: idempotencyKey, request_hash: requestHash, created_at: now, updated_at: now,
  };
  const admin = createAdminClient();
  const { error } = await admin.from("circuits").insert(row);
  if (error) {
    const raced = await existingCircuit(principal, idempotencyKey, requestHash);
    if (raced) return { circuit: circuitResource(raced), replayed: true };
    throw error;
  }
  return { circuit: circuitResource(row), replayed: false };
}

async function readCircuit(principal: Principal, circuitId: string, allowReleased = false): Promise<DbRow & { source: string }> {
  if (principal.demo) {
    const circuit = demoV2Circuits.get(circuitId);
    if (!circuit || circuit.organization_id !== principal.organizationId) throw new V2ApiError(404, "circuit_not_found", "Circuit not found.");
    if (circuit.released_at && !allowReleased) throw new V2ApiError(409, "circuit_released", "Circuit source has been released.");
    return circuit as unknown as DbRow & { source: string };
  }
  const { data, error } = await createAdminClient().from("circuits").select("*").eq("id", circuitId).eq("organization_id", principal.organizationId).maybeSingle();
  if (error) throw error;
  if (!data) throw new V2ApiError(404, "circuit_not_found", "Circuit not found.");
  if (data.released_at && !allowReleased) throw new V2ApiError(409, "circuit_released", "Circuit source has been released.");
  return data as DbRow & { source: string };
}

export async function getCircuitResource(principal: Principal, circuitId: string) {
  const circuit = await readCircuit(principal, circuitId, true);
  return circuitResource(circuit as unknown as DbRow);
}

export async function releaseCircuitResource(principal: Principal, circuitId: string) {
  if (principal.demo) {
    const circuit = demoV2Circuits.get(circuitId);
    if (!circuit || circuit.organization_id !== principal.organizationId) throw new V2ApiError(404, "circuit_not_found", "Circuit not found.");
    const active = [...demoV2Groups.values()].some((group) => group.circuit_id === circuitId && ["queued", "running", "awaiting_payment"].includes(group.status));
    if (active) throw new V2ApiError(409, "circuit_active", "Every job for this circuit must be terminal before release.");
    for (const group of demoV2Groups.values()) {
      if (group.circuit_id !== circuitId) continue;
      for (const execution of group.executions) {
        const job = demoJobs.get(String(execution.id));
        if (job) {
          job.source = "";
          job.result = null;
          job.analysis = releasedAnalysis(job.analysis);
          job.route_decision = releasedRouteDecision(job.route_decision) as StoredJob["route_decision"];
        }
        // The execution summary holds its own copy of the analysis, so the
        // transpiled QASM survives here even after the job row is cleared.
        execution.analysis = releasedAnalysis(execution.analysis);
        execution.route_decision = releasedRouteDecision(execution.route_decision);
        execution.result_available = false;
      }
    }
    circuit.source = "";
    // analysis.normalizedQasm2 is the whole circuit again, and analysis is part
    // of the public circuit resource.
    circuit.analysis = { ...releasedAnalysis(circuit.analysis) };
    circuit.released_at ??= new Date().toISOString();
    return circuitResource(circuit as unknown as DbRow);
  }
  const admin = createAdminClient();
  const { data: circuit, error } = await admin.from("circuits").select("id,released_at").eq("id", circuitId).eq("organization_id", principal.organizationId).maybeSingle();
  if (error) throw error;
  if (!circuit) throw new V2ApiError(404, "circuit_not_found", "Circuit not found.");
  const { count, error: countError } = await admin.from("execution_groups").select("id", { count: "exact", head: true }).eq("circuit_id", circuitId).in("status", ["queued", "running", "awaiting_payment"]);
  if (countError) throw countError;
  if ((count ?? 0) > 0) throw new V2ApiError(409, "circuit_active", "Every job for this circuit must be terminal before release.");
  await purgeCircuitData(admin, principal, circuitId, "release");
  const { data: released, error: refetchError } = await admin.from("circuits").select("*").eq("id", circuitId).eq("organization_id", principal.organizationId).single();
  if (refetchError) throw refetchError;
  return circuitResource(released as DbRow);
}

/**
 * Runs the transactional scrub and then removes the encrypted artifact objects.
 *
 * Clearing jobs.source/result/analysis was never enough — the full QASM and the
 * full result also lived in job_attempts.request/response, webhook_deliveries
 * .payload and job_events.payload, all of which an org member can read over
 * PostgREST. purge_circuit_data covers every one of those in one transaction
 * and stamps released_at first, so a concurrent job creation cannot copy the
 * source into fresh rows behind the purge.
 *
 * Artifact objects live in Supabase Storage / Vultr object storage and cannot
 * be deleted from SQL, so the RPC hands back the job ids and deleteJobArtifacts
 * removes the objects before their metadata rows.
 */
async function purgeCircuitData(admin: ReturnType<typeof createAdminClient>, principal: Principal, circuitId: string, action: "release" | "deletion") {
  const { data, error } = await admin.rpc("purge_circuit_data", { p_circuit_id: circuitId, p_organization_id: principal.organizationId });
  if (error) {
    // 55006 (object_in_use) is raised when a group is still live. The pre-check
    // above usually catches it; this is the race-safe backstop.
    if (error.code === "55006" || /circuit_active/.test(error.message ?? "")) {
      throw new V2ApiError(409, "circuit_active", `Every job for this circuit must be terminal before ${action}.`);
    }
    throw error;
  }
  if (!data) throw new V2ApiError(404, "circuit_not_found", "Circuit not found.");
  const jobIds = ((data as { job_ids?: unknown }).job_ids ?? []) as string[];
  await deleteJobArtifacts(jobIds);
  return jobIds;
}

export async function deleteCircuitResource(principal: Principal, circuitId: string) {
  if (principal.demo) {
    const circuit = demoV2Circuits.get(circuitId);
    if (!circuit || circuit.organization_id !== principal.organizationId) throw new V2ApiError(404, "circuit_not_found", "Circuit not found.");
    const groups = [...demoV2Groups.values()].filter((group) => group.circuit_id === circuitId);
    if (groups.some((group) => ["queued", "running", "awaiting_payment"].includes(group.status))) throw new V2ApiError(409, "circuit_active", "Every job for this circuit must be terminal before deletion.");
    for (const group of groups) {
      for (const execution of group.executions) demoJobs.delete(String(execution.id));
      demoV2Groups.delete(group.id);
    }
    demoV2Circuits.delete(circuitId);
    return;
  }
  const admin = createAdminClient();
  const { data: circuit, error } = await admin.from("circuits").select("id").eq("id", circuitId).eq("organization_id", principal.organizationId).maybeSingle();
  if (error) throw error;
  if (!circuit) throw new V2ApiError(404, "circuit_not_found", "Circuit not found.");
  const { count, error: countError } = await admin.from("execution_groups").select("id", { count: "exact", head: true }).eq("circuit_id", circuitId).in("status", ["queued", "running", "awaiting_payment"]);
  if (countError) throw countError;
  if ((count ?? 0) > 0) throw new V2ApiError(409, "circuit_active", "Every job for this circuit must be terminal before deletion.");
  // Scrub before deleting rows. jobs.circuit_id is ON DELETE SET NULL, so
  // dropping the circuit first used to orphan job rows that still held the
  // complete source with no link back to the circuit that was "deleted".
  await purgeCircuitData(admin, principal, circuitId, "deletion");
  // execution_groups.circuit_id is ON DELETE RESTRICT, so terminal groups (and
  // their jobs, which cascade from group_id) have to go before the circuit row.
  const { error: groupsError } = await admin.from("execution_groups").delete().eq("circuit_id", circuitId).eq("organization_id", principal.organizationId);
  if (groupsError) throw groupsError;
  const { error: deleteError } = await admin.from("circuits").delete().eq("id", circuitId).eq("organization_id", principal.organizationId);
  if (deleteError) throw deleteError;
}

async function prepareGroupExecutions(principal: Principal, circuit: DbRow & { source: string }, input: CreateExecutionGroupInput, demo = false): Promise<PreparedExecution[]> {
  const [context, analysis] = await Promise.all([
    loadRoutingContext(demo),
    Promise.resolve(circuit.analysis),
  ]);
  const format: InputFormat = (circuit.input_format ?? circuit.format) === "openqasm3" ? "openqasm3" : "openqasm2";
  // Each prepareExecution is a full remote transpile; a 25-execution group must
  // not fire 25 of them at the Qiskit worker from one request.
  return mapWithConcurrency(input.executions, EXECUTION_FANOUT_LIMIT, async (execution) => {
    assertTargetAllowedV2(principal, execution.target, context.backends);
    const prepared = await prepareExecution({
      backends: backendsForPrincipal(principal, context.backends),
      analysis: analysis as never,
      shots: execution.shots,
      target: execution.target,
      mode: execution.routing_mode,
      constraints: execution.constraints,
      qciSnapshotId: context.snapshot.id,
      qciTimestamp: context.snapshot.ts,
      optimizationLevel: execution.optimization_level,
      source: circuit.source,
      format,
      failover: { enabled: execution.failover, max_attempts: execution.max_attempts },
    });
    return { ...execution, ...prepared };
  });
}

/**
 * Drops a half-built group (its jobs cascade) so the failure is retriable.
 * Otherwise the idempotency key replays a group whose executions are stuck in
 * `quoted`, a status the orchestrator never claims.
 */
async function discardGroup(admin: ReturnType<typeof createAdminClient>, groupId: string) {
  const { error } = await admin.from("execution_groups").delete().eq("id", groupId);
  if (error) console.error(`Failed to discard incomplete execution group ${groupId}`, error);
}

function groupFromDemo(id: string): DemoGroup {
  const group = demoV2Groups.get(id);
  if (!group) throw new V2ApiError(404, "job_not_found", "Job not found.");
  return group;
}

export async function getExecutionGroup(principal: Principal, groupId: string): Promise<ExecutionGroup> {
  if (principal.demo) {
    const group = groupFromDemo(groupId);
    if (group.organization_id !== principal.organizationId) throw new V2ApiError(404, "job_not_found", "Job not found.");
    return groupResource(group);
  }
  const admin = createAdminClient();
  const { data: group, error } = await admin.from("execution_groups").select("*").eq("id", groupId).eq("organization_id", principal.organizationId).maybeSingle();
  if (error) throw error;
  if (!group) throw new V2ApiError(404, "job_not_found", "Job not found.");
  const { data: jobs, error: jobsError } = await admin.from("jobs").select("id,execution_key,status,target,selected_backend_id,shots,routing_mode,analysis,route_decision,error,created_at,updated_at,completed_at").eq("group_id", groupId).order("execution_position");
  if (jobsError) throw jobsError;
  const ids = (jobs ?? []).map((job) => job.id);
  const { data: quotes, error: quotesError } = ids.length ? await admin.from("quotes").select("*").in("job_id", ids) : { data: [], error: null };
  if (quotesError) throw quotesError;
  const quotesByJob = new Map((quotes ?? []).map((quote) => [quote.job_id, quote as DbRow]));
  return {
    id: group.id, circuit_id: group.circuit_id, organization_id: group.organization_id, status: group.status,
    metadata: group.metadata ?? {}, executions: (jobs ?? []).map((job) => executionSummary(job as DbRow, quotesByJob.get(job.id))),
    created_at: group.created_at, updated_at: group.updated_at, completed_at: group.completed_at, error: group.error,
  } as ExecutionGroup;
}

async function createDemoGroup(principal: Principal, circuit: DemoCircuit, input: CreateExecutionGroupInput, idempotencyKey: string, requestHash: string) {
  const now = new Date().toISOString();
  const prepared = await prepareGroupExecutions(principal, circuit as unknown as DbRow & { source: string }, input, true);
  const groupId = newV2Id();
  const executions = await mapWithConcurrency(prepared, EXECUTION_FANOUT_LIMIT, async (item) => {
    const id = newV2Id();
    const analysis = { ...(circuit.analysis as object), transpilation: publicTranspilation(item.transpilation), encoding: item.encoding };
    const job: StoredJob = {
      id, organization_id: principal.organizationId, name: null, input_format: circuit.format, source: circuit.source,
      shots: item.shots, target: item.target, routing_mode: item.routing_mode, status: "submitted",
      selected_backend_id: item.decision.selected.id, analysis: analysis as StoredJob["analysis"], route_decision: item.decision,
      quote: item.quote, result: null, error: null, created_at: now, updated_at: now, completed_at: null,
    };
    demoJobs.set(id, job);
    try {
      const submission = await submitToProvider(item.decision.selected.id, item.executionAnalysis, item.shots, `${id}-1`, item.bundles[0]);
      job.status = submission.status === "completed" ? "completed" : "submitted";
      job.result = submission.result ? normalizeProviderResult(item.decision.selected.id, submission.result, item.shots, item.encoding?.selected_bundle?.decode_map) : null;
      job.completed_at = job.status === "completed" ? new Date().toISOString() : null;
      job.updated_at = new Date().toISOString();
    } catch (error) {
      job.status = "failed";
      job.error = { message: error instanceof Error ? error.message : "Execution failed." };
      job.completed_at = new Date().toISOString();
    }
    return { ...executionSummary(job as unknown as DbRow), key: item.key };
  });
  const status = groupStatusFrom(executions.map((execution) => String(execution.status)));
  const pending = status === "running" || status === "awaiting_payment";
  const group: DemoGroup = {
    id: groupId, circuit_id: circuit.id, organization_id: principal.organizationId, status, metadata: input.metadata,
    executions, created_at: now, updated_at: new Date().toISOString(), completed_at: pending ? null : new Date().toISOString(),
    error: status === "failed" ? { message: "All execution targets failed." } : null, idempotency_key: idempotencyKey, request_hash: requestHash,
  };
  demoV2Groups.set(groupId, group);
  return { group: groupResource(group), replayed: false, outcome: status === "running" ? "queued" : status };
}

export async function createExecutionGroup(principal: Principal, input: CreateExecutionGroupInput, idempotencyKey: string, requestId: string) {
  const requestHash = hashRequest(input);
  if (principal.demo) {
    const existing = [...demoV2Groups.values()].find((group) => group.organization_id === principal.organizationId && group.idempotency_key === idempotencyKey);
    if (existing) {
      if (existing.request_hash !== requestHash) throw new V2ApiError(409, "idempotency_conflict", "Idempotency key was already used for a different job.");
      return { group: groupResource(existing), replayed: true, outcome: existing.status };
    }
    const circuit = await readCircuit(principal, input.circuit_id) as unknown as DemoCircuit;
    return createDemoGroup(principal, circuit, input, idempotencyKey, requestHash);
  }
  const replay = await existingGroup(principal, idempotencyKey, requestHash);
  if (replay) return { group: await getExecutionGroup(principal, String(replay.id)), replayed: true, outcome: replay.status };
  const circuit = await readCircuit(principal, input.circuit_id);
  const prepared = await prepareGroupExecutions(principal, circuit, input, false);
  const admin = createAdminClient();
  const groupId = newV2Id();
  const now = new Date().toISOString();
  const { error: groupError } = await admin.from("execution_groups").insert({
    id: groupId, organization_id: principal.organizationId, circuit_id: circuit.id, user_id: principal.userId, api_key_id: principal.apiKeyId,
    idempotency_key: idempotencyKey, request_hash: requestHash, metadata: input.metadata, status: "queued", created_at: now, updated_at: now,
  });
  if (groupError) {
    const raced = await existingGroup(principal, idempotencyKey, requestHash);
    if (raced) return { group: await getExecutionGroup(principal, String(raced.id)), replayed: true, outcome: raced.status };
    throw groupError;
  }
  const jobs = prepared.map((item, position) => ({
    id: newV2Id(), organization_id: principal.organizationId, user_id: principal.userId, api_key_id: principal.apiKeyId,
    group_id: groupId, circuit_id: circuit.id, execution_key: item.key, execution_position: position,
    name: null, input_format: circuit.input_format, source: circuit.source, source_hash: circuit.source_hash,
    shots: item.shots, target: item.target, routing_mode: item.routing_mode, constraints: item.constraints,
    analysis: { ...(circuit.analysis as object), transpilation: publicTranspilation(item.transpilation), encoding: item.encoding }, route_decision: item.decision,
    selected_backend_id: item.decision.selected.id, status: "quoted", failover_enabled: item.failover, max_attempts: item.max_attempts,
    execution_timeout_seconds: item.timeout_seconds, next_attempt_at: now, request_id: requestId, created_at: now, updated_at: now,
  }));
  const { error: jobsError } = await admin.from("jobs").insert(jobs);
  if (jobsError) { await discardGroup(admin, groupId); throw jobsError; }
  await mapWithConcurrency(jobs, EXECUTION_FANOUT_LIMIT, (job, index) => storeArtifact({
    jobId: job.id, organizationId: principal.organizationId, kind: "transpiled",
    content: prepared[index].transpilation.artifactQasm ?? prepared[index].transpilation.qasm,
  }).catch((error) => console.error(`Failed to store v2 transpilation artifact for ${job.id}`, error)));
  const quotes = jobs.map((job, index) => ({
    job_id: job.id, provider_cost: prepared[index].quote.providerCost, transpiler_fee: prepared[index].quote.transpilerFee,
    platform_fee: prepared[index].quote.platformFee, total: prepared[index].quote.total,
    rate_snapshot: prepared[index].quote.rateSnapshot, expires_at: prepared[index].quote.expiresAt,
  }));
  const { data: outcome, error: queueError } = await admin.rpc("queue_execution_group_with_quotes", { p_group_id: groupId, p_quotes: quotes });
  if (queueError) { await discardGroup(admin, groupId); throw queueError; }
  return { group: await getExecutionGroup(principal, groupId), replayed: false, outcome: String(outcome) };
}

export async function getExecutionArtifact(principal: Principal, executionId: string, kind: "result" | "transpiled") {
  if (principal.demo) {
    const job = demoJobs.get(executionId);
    if (!job || job.organization_id !== principal.organizationId) throw new V2ApiError(404, "execution_not_found", "Execution not found.");
    if (kind === "result" && !job.result) throw new V2ApiError(409, "result_not_available", "Result is not available.");
    if (kind === "result") return JSON.stringify(job.result);
    const transpilation = job.analysis.transpilation;
    const artifact = transpilation?.artifactQasm ?? transpilation?.qasm ?? job.analysis.normalizedQasm2;
    if (!artifact) throw new V2ApiError(409, "transpiled_not_available", "Transpiled circuit is not available.");
    return artifact;
  }
  const { data, error } = await createAdminClient().from("jobs").select("id").eq("id", executionId).eq("organization_id", principal.organizationId).not("group_id", "is", null).maybeSingle();
  if (error) throw error;
  if (!data) throw new V2ApiError(404, "execution_not_found", "Execution not found.");
  const artifact = await loadArtifact(executionId, kind);
  if (!artifact) throw new V2ApiError(409, `${kind}_not_available`, `${kind === "result" ? "Result" : "Transpiled circuit"} is not available.`);
  return artifact;
}

export async function cancelExecution(principal: Principal, executionId: string) {
  const terminal = ["completed", "failed", "cancelled"];
  if (principal.demo) {
    const job = demoJobs.get(executionId);
    if (!job || job.organization_id !== principal.organizationId) throw new V2ApiError(404, "execution_not_found", "Execution not found.");
    if (terminal.includes(job.status)) throw new V2ApiError(409, "not_cancellable", "Execution is already terminal.");
    job.status = "cancelled";
    job.updated_at = new Date().toISOString();
    for (const group of demoV2Groups.values()) {
      const execution = group.executions.find((candidate) => candidate.id === executionId);
      if (execution) {
        execution.status = "cancelled";
        group.status = groupStatusFrom(group.executions.map((candidate) => String(candidate.status)));
        group.updated_at = new Date().toISOString();
        group.completed_at = group.status === "running" || group.status === "awaiting_payment" ? null : new Date().toISOString();
      }
    }
    return { id: job.id, status: job.status };
  }
  const admin = createAdminClient();
  const { data: job, error } = await admin.from("jobs").select("id,status,selected_backend_id,provider_job_id").eq("id", executionId).eq("organization_id", principal.organizationId).not("group_id", "is", null).maybeSingle();
  if (error) throw error;
  if (!job) throw new V2ApiError(404, "execution_not_found", "Execution not found.");
  if (terminal.includes(job.status)) throw new V2ApiError(409, "not_cancellable", "Execution is already terminal.");
  if (["submitted", "processing"].includes(job.status) && job.provider_job_id) {
    const { data: changed, error: updateError } = await admin.from("jobs").update({ status: "cancellation_requested", execution_deadline_at: null, timeout_failover_pending: false, updated_at: new Date().toISOString() }).eq("id", executionId).eq("status", job.status).select("id").maybeSingle();
    if (updateError) throw updateError;
    if (!changed) throw new V2ApiError(409, "execution_changed", "Execution changed while cancellation was requested.");
    await cancelProviderJob(job.selected_backend_id, job.provider_job_id);
    return { id: job.id, status: "cancellation_requested" };
  }
  const { data: changed, error: finalizeError } = await admin.rpc("finalize_qrouter_job", { p_job_id: executionId, p_status: "cancelled", p_result: null, p_error: null, p_actual_provider_cost: null });
  if (finalizeError) throw finalizeError;
  if (!changed) throw new V2ApiError(409, "execution_changed", "Execution changed while cancellation was requested.");
  return { id: job.id, status: "cancelled" };
}
