import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Principal } from "./auth";
import { demoJobs } from "./demo-store";
import { jcsHash } from "./encoding/jcs";
import { slimResult } from "./encoding/public";
import { assessDistribution, type ExperimentDefinition, type ExperimentResource, type ExperimentRun } from "./experiments";
import { prepareExecution } from "./pipeline";
import { loadRoutingContext } from "./routingContext";
import { assertTargetAllowedV2, backendsForPrincipal } from "./scopes";
import { createExecutionGroupSchema } from "./v2";
import { V2ApiError } from "./v2-http";
import { createExecutionGroup, getCircuitResource, getExecutionGroup } from "./v2-service";
import { demoV2Circuits } from "./v2-demo-store";

type StoredExperiment = ExperimentResource & { idempotency_key: string; request_hash: string };
type StoredRun = ExperimentRun & { idempotency_key: string; request_hash: string };
const state = globalThis as typeof globalThis & { __qrouterExperiments?: Map<string, StoredExperiment>; __qrouterExperimentRuns?: Map<string, StoredRun> };
const demoExperiments = state.__qrouterExperiments ?? new Map<string, StoredExperiment>();
const demoRuns = state.__qrouterExperimentRuns ?? new Map<string, StoredRun>();
if (process.env.NODE_ENV !== "production") { state.__qrouterExperiments = demoExperiments; state.__qrouterExperimentRuns = demoRuns; }

function storageError(error: unknown): never {
  if (error && typeof error === "object" && ["42P01", "PGRST205"].includes(String((error as { code?: unknown }).code))) {
    throw new V2ApiError(503, "experiments_unavailable", "Experiment storage is not installed. Apply supabase/experiments.sql before enabling campaigns.");
  }
  throw error;
}

function publicExperiment(row: StoredExperiment): ExperimentResource {
  const { idempotency_key: _key, request_hash: _hash, ...resource } = row;
  const releasedAt = row.released_at ?? demoV2Circuits.get(row.definition.circuit_id)?.released_at;
  if (releasedAt) return { ...resource, released_at: releasedAt, definition: { ...resource.definition,
    reference: { kind: "none", reason: "Circuit data was released." }, success_criterion: { metric: "record_only" } } };
  return resource;
}

export async function listExperiments(principal: Principal) {
  if (principal.demo) return [...demoExperiments.values()].filter((row) => row.organization_id === principal.organizationId && demoV2Circuits.has(row.definition.circuit_id)).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(publicExperiment);
  const { data, error } = await createAdminClient().from("experiments").select("*").eq("organization_id", principal.organizationId).order("created_at", { ascending: false }).limit(100);
  if (error) storageError(error);
  return (data ?? []).map((row) => publicExperiment(row as StoredExperiment));
}

export async function getExperiment(principal: Principal, id: string): Promise<ExperimentResource> {
  let row: StoredExperiment | null;
  if (principal.demo) row = demoExperiments.get(id) ?? null;
  else {
    const result = await createAdminClient().from("experiments").select("*").eq("id", id).eq("organization_id", principal.organizationId).maybeSingle();
    if (result.error) storageError(result.error);
    row = result.data as StoredExperiment | null;
  }
  if (!row || row.organization_id !== principal.organizationId) throw new V2ApiError(404, "experiment_not_found", "Experiment not found.");
  const circuit = await getCircuitResource(principal, row.definition.circuit_id);
  return { ...publicExperiment(row), released_at: circuit.released_at ?? row.released_at };
}

export async function createExperiment(principal: Principal, definition: ExperimentDefinition, key: string) {
  const requestHash = jcsHash(definition);
  const findExisting = async () => {
    if (principal.demo) return [...demoExperiments.values()].find((row) => row.organization_id === principal.organizationId && row.idempotency_key === key) ?? null;
    const { data, error } = await createAdminClient().from("experiments").select("*").eq("organization_id", principal.organizationId).eq("idempotency_key", key).maybeSingle();
    if (error) storageError(error);
    return data as StoredExperiment | null;
  };
  const replay = await findExisting();
  if (replay) {
    if (replay.request_hash !== requestHash) throw new V2ApiError(409, "idempotency_conflict", "Idempotency key was used for a different experiment.");
    return { experiment: publicExperiment(replay), replayed: true };
  }
  const circuit = await getCircuitResource(principal, definition.circuit_id);
  if (circuit.released_at) throw new V2ApiError(409, "circuit_released", "Choose a circuit whose source is still available.");
  if (definition.reference.kind === "distribution" && Object.keys(definition.reference.probabilities).some((bits) => bits.length !== Number(circuit.analysis.classicalBits))) {
    throw new V2ApiError(422, "reference_width_mismatch", "Reference bitstrings must match the circuit's classical memory width.");
  }
  const previous = definition.previous_version_id ? await getExperiment(principal, definition.previous_version_id) : null;
  const row: StoredExperiment = {
    id: randomUUID(), organization_id: principal.organizationId, version: previous ? previous.version + 1 : 1,
    definition, source_hash: circuit.source_hash, definition_hash: jcsHash({ definition, source_hash: circuit.source_hash }),
    created_at: new Date().toISOString(), released_at: null, idempotency_key: key, request_hash: requestHash,
  };
  if (principal.demo) {
    // Recheck synchronously after awaited circuit reads, before publishing.
    const raced = [...demoExperiments.values()].find((item) => item.organization_id === principal.organizationId && item.idempotency_key === key);
    if (raced) {
      if (raced.request_hash !== requestHash) throw new V2ApiError(409, "idempotency_conflict", "Idempotency key was used for a different experiment.");
      return { experiment: publicExperiment(raced), replayed: true };
    }
    demoExperiments.set(row.id, row);
  }
  else {
    const { error } = await createAdminClient().from("experiments").insert(row);
    if (error) {
      const raced = await findExisting();
      if (!raced) storageError(error);
      if (raced.request_hash !== requestHash) throw new V2ApiError(409, "idempotency_conflict", "Idempotency key was used for a different experiment.");
      return { experiment: publicExperiment(raced), replayed: true };
    }
  }
  return { experiment: publicExperiment(row), replayed: false };
}

function executionInput(experiment: ExperimentResource) {
  const d = experiment.definition;
  return createExecutionGroupSchema.parse({
    circuit_id: d.circuit_id, max_total_cost: d.max_total_cost,
    metadata: { experiment_id: experiment.id, definition_hash: experiment.definition_hash },
    executions: d.targets.map((target, index) => ({ key: `target-${index + 1}`, target, shots: d.shots, routing_mode: "balanced", failover: false, max_attempts: 1, constraints: { executionIntent: d.execution_intent } })),
  });
}

export async function quoteExperiment(principal: Principal, id: string) {
  const experiment = await getExperiment(principal, id);
  if (experiment.released_at) throw new V2ApiError(409, "circuit_released", "This experiment's circuit was released.");
  let source: string;
  const circuit = await getCircuitResource(principal, experiment.definition.circuit_id);
  if (principal.demo) source = demoV2Circuits.get(circuit.id)!.source;
  else {
    const { data, error } = await createAdminClient().from("circuits").select("source").eq("id", circuit.id).eq("organization_id", principal.organizationId).single();
    if (error) throw error;
    source = String(data.source);
  }
  const context = await loadRoutingContext(principal.demo);
  const executions = [];
  for (const target of experiment.definition.targets) {
    assertTargetAllowedV2(principal, target, context.backends);
    const prepared = await prepareExecution({ backends: backendsForPrincipal(principal, context.backends), analysis: circuit.analysis as never,
      shots: experiment.definition.shots, target, mode: "balanced", source, format: circuit.format,
      constraints: { executionIntent: experiment.definition.execution_intent }, failover: { enabled: false, max_attempts: 1 } });
    executions.push({ target, selected_backend_id: prepared.decision.selected.id, quote: prepared.quote,
      compilation: { before: prepared.transpilation.before, after: prepared.transpilation.after },
      verification: prepared.encoding?.selected_bundle?.verification ?? "unsupported" });
  }
  const total = Math.round(executions.reduce((sum, e) => sum + e.quote.total, 0) * 1_000_000) / 1_000_000;
  return { definition_hash: experiment.definition_hash, total, max_total_cost: experiment.definition.max_total_cost,
    within_budget: total <= experiment.definition.max_total_cost, currency: "usd", executions,
    note: "Estimates are recalculated before reservation. The approved campaign ceiling applies to the complete group. No jobs were submitted by this preview." };
}

export async function runExperiment(principal: Principal, id: string, approval: { approved_definition_hash: string; approved_max_total_cost: number }, key: string, requestId: string) {
  const experiment = await getExperiment(principal, id);
  if (experiment.released_at) throw new V2ApiError(409, "circuit_released", "This experiment's circuit was released.");
  if (approval.approved_definition_hash !== experiment.definition_hash || approval.approved_max_total_cost !== experiment.definition.max_total_cost) {
    throw new V2ApiError(409, "approval_mismatch", "Approve the current immutable definition and its exact campaign ceiling.");
  }
  const requestHash = jcsHash({ experiment_id: id, ...approval });
  const findExisting = async () => {
    if (principal.demo) return [...demoRuns.values()].find((row) => row.organization_id === principal.organizationId && row.idempotency_key === key) ?? null;
    const { data, error } = await createAdminClient().from("experiment_runs").select("*").eq("organization_id", principal.organizationId).eq("idempotency_key", key).maybeSingle();
    if (error) storageError(error);
    return data as StoredRun | null;
  };
  let run = await findExisting();
  const replayed = Boolean(run);
  if (run && run.request_hash !== requestHash) throw new V2ApiError(409, "idempotency_conflict", "Idempotency key was used for a different campaign run.");
  if (!run) {
    run = { id: randomUUID(), experiment_id: id, organization_id: principal.organizationId, group_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), preparation_status: "preparing", preparation_error: null, ...approval, idempotency_key: key, request_hash: requestHash };
    if (principal.demo) {
      const raced = [...demoRuns.values()].find((item) => item.organization_id === principal.organizationId && item.idempotency_key === key);
      if (raced) run = raced;
      else demoRuns.set(run.id, run);
      if (run.request_hash !== requestHash) throw new V2ApiError(409, "idempotency_conflict", "Idempotency key was used for a different campaign run.");
    }
    else {
      const { error } = await createAdminClient().from("experiment_runs").insert(run);
      if (error) { const raced = await findExisting(); if (!raced) storageError(error); run = raced; }
      if (run.request_hash !== requestHash) throw new V2ApiError(409, "idempotency_conflict", "Idempotency key was used for a different campaign run.");
    }
  }
  let result;
  try {
    result = await createExecutionGroup(principal, executionInput(experiment), `experiment-run:${run.id}`, requestId);
  } catch (error) {
    if (!run.group_id) {
      const rejectedBeforeSubmission = error instanceof V2ApiError && ["campaign_budget_exceeded", "circuit_released", "circuit_not_found", "invalid_circuit"].includes(error.code);
      run.preparation_status = rejectedBeforeSubmission ? "not_submitted" : "preparing";
      run.preparation_error = { message: rejectedBeforeSubmission ? error.message : "Submission outcome is unknown. Retry using the same idempotency key to recover its status before creating another run." };
      run.updated_at = new Date().toISOString();
      if (!principal.demo) await createAdminClient().from("experiment_runs").update({ preparation_status: run.preparation_status, preparation_error: run.preparation_error, updated_at: run.updated_at }).eq("id", run.id).eq("organization_id", principal.organizationId).is("group_id", null);
    }
    throw error;
  }
  run.group_id = result.group.id;
  run.preparation_status = "accepted";
  run.preparation_error = null;
  run.updated_at = new Date().toISOString();
  if (!principal.demo) {
    const { error } = await createAdminClient().from("experiment_runs").update({ group_id: run.group_id, preparation_status: "accepted", preparation_error: null, updated_at: run.updated_at }).eq("id", run.id).eq("organization_id", principal.organizationId);
    if (error) throw error;
  }
  return { run: { id: run.id, group_id: run.group_id }, group: result.group, outcome: result.outcome, replayed };
}

export async function experimentEvidence(principal: Principal, id: string) {
  const experiment = await getExperiment(principal, id);
  let runs: StoredRun[];
  if (principal.demo) runs = [...demoRuns.values()].filter((row) => row.experiment_id === id && row.organization_id === principal.organizationId);
  else {
    const { data, error } = await createAdminClient().from("experiment_runs").select("*").eq("experiment_id", id).eq("organization_id", principal.organizationId).order("created_at", { ascending: false }).limit(50);
    if (error) storageError(error);
    runs = (data ?? []) as StoredRun[];
  }
  const evidence = [];
  for (const run of runs.sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    if (!run.group_id) {
      const status = run.preparation_status === "not_submitted" ? "not_submitted" : !run.preparation_error && Date.now() - Date.parse(run.updated_at ?? run.created_at) < 120_000 ? "preparing" : "preparation_unknown";
      evidence.push({ id: run.id, created_at: run.created_at, status, error: run.preparation_error, group_id: null, executions: [] }); continue;
    }
    const group = await getExecutionGroup(principal, run.group_id);
    const executions = [];
    for (const summary of group.executions) {
      const jobId = String(summary.id);
      let result: unknown = null;
      let charged: number | null = null;
      let resultHash: string | null = null;
      if (principal.demo) result = demoJobs.get(jobId)?.result;
      else {
        const admin = createAdminClient();
        const [{ data: job, error }, { data: ledger, error: ledgerError }] = await Promise.all([
          admin.from("jobs").select("result").eq("id", jobId).eq("organization_id", principal.organizationId).maybeSingle(),
          admin.from("ledger_entries").select("type,amount").eq("job_id", jobId).eq("organization_id", principal.organizationId).eq("type", "charge"),
        ]);
        if (error) throw error;
        if (ledgerError) throw ledgerError;
        result = job?.result;
        if (ledger?.length) charged = ledger.reduce((sum, entry) => sum - Number(entry.amount), 0);
      }
      const publicResult = result ? slimResult(result) : null;
      if (publicResult) resultHash = jcsHash(publicResult);
      const assessment = summary.status === "completed" && !experiment.released_at
        ? assessDistribution(experiment.definition, result)
        : { status: "inconclusive", reason: experiment.released_at ? "Circuit data was released." : "Execution is not completed.", distance: null, interval: null, shots: null, confidence: null };
      executions.push({ ...summary, assessment, result: publicResult, result_hash: resultHash, result_hash_method: "sha256-jcs", charged_usd: charged,
        cost_status: principal.demo ? "local_demo_unbilled" : charged == null ? "not_reconciled" : "customer_ledger_charge" });
    }
    evidence.push({ id: run.id, group_id: run.group_id, created_at: run.created_at, status: group.status, executions });
  }
  return { schema_version: "experiment-evidence/1", experiment, runs: evidence, generated_at: new Date().toISOString(),
    limitations: ["References are supplied by the experiment author; their provenance is recorded, not independently certified.", "Statistical intervals are per execution, assume independent shots from a fixed distribution, and are conservative. They do not adjust for repeated runs, backend selection, or calibration drift.", "A passed circuit criterion does not establish business value or quantum advantage.", "A customer ledger charge is distinct from an independently reconciled provider invoice. Missing costs remain unknown."] };
}
