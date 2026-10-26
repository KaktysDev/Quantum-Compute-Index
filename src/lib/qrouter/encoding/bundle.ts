/**
 * Envelope + ExecutionBundle construction and verification reports (§5.2, §5.9, §5.11).
 */

import { createHash } from "crypto";
import type { RoutingConstraints, RoutingMode, TranspilationResult } from "../types";
import { frontendInfo, workloadFromSource } from "./frontend";
import { jcsHash } from "./jcs";
import { deriveRequirements, satisfies } from "./satisfy";
import {
  ADAPTER_VERSION,
  BUNDLE_SCHEMA,
  FRONTEND_VERSION,
  QEE_SCHEMA,
} from "./types";
import type {
  CapabilityProfile,
  DecodeMap,
  ExecutionBundle,
  ExecutionEnvelope,
  QuoteBinding,
  VerificationReport,
  VerificationStatus,
  Workload,
} from "./types";

export function buildEnvelope(input: {
  workload: Workload;
  source: string;
  routing_mode: RoutingMode;
  constraints?: RoutingConstraints;
  failover?: { enabled: boolean; max_attempts: number };
}): ExecutionEnvelope {
  const requirements = deriveRequirements(input.workload);
  const created_at = new Date().toISOString();
  const source_sha256 = createHash("sha256").update(input.source).digest("hex");
  const body = {
    schema_version: QEE_SCHEMA,
    created_at,
    workload: input.workload,
    requirements,
    policy: {
      routing_mode: input.routing_mode,
      constraints: input.constraints ?? {},
      failover: input.failover ?? { enabled: true, max_attempts: 3 },
      verification: { minimum_status: "unsupported" as const },
    },
    provenance: {
      source_sha256,
      frontend: frontendInfo(),
    },
  };
  // created_at is telemetry. Hashing it (or the full AST) made every quote a
  // unique document and forced a JCS walk of every gate on the hot path.
  // source_sha256 is the program identity; requirements + policy are the rest.
  const shots = "shots" in input.workload ? input.workload.shots : "reads" in input.workload ? input.workload.reads : 0;
  return {
    ...body,
    id: jcsHash({
      schema_version: body.schema_version,
      source_sha256,
      workload_kind: input.workload.kind,
      shots,
      requirements,
      policy: body.policy,
      frontend: body.provenance.frontend,
    }),
  };
}

export function verificationFromTranspile(result: TranspilationResult | null, capability: CapabilityProfile): VerificationReport {
  let legality: VerificationStatus = "unsupported";
  let legalityNote = "No compiled gate artifact was checked.";
  if (result) {
    try {
      const requirements = deriveRequirements(workloadFromSource(result.qasm, "openqasm2", 0));
      const verdict = satisfies(requirements, capability);
      legality = verdict.ok ? "checked" : "failed";
      legalityNote = verdict.ok ? "Compiled gate requirements satisfy the advertised target profile; provider schema and calibration are separate checks." : verdict.failures.map((failure) => failure.message).join("; ");
    } catch (error) {
      legality = "failed";
      legalityNote = error instanceof Error ? error.message : "Compiled artifact could not be parsed.";
    }
  }
  const status = legality === "failed" ? "failed" : result ? verificationStatusOf(result.equivalent, result.verificationNote) : "unsupported";
  return {
    status,
    gates_run: [
      { gate: "G1", status: result ? "checked" : "unsupported", detail: "Source accepted by the supported frontend; this is not a formal type or semantic proof." },
      { gate: "G3", status: legality, detail: legalityNote },
      { gate: "G6", status, detail: result?.verificationNote ?? "No compiler verification." },
    ],
    bound_to: {
      compiler_version: result?.compiler ?? "none",
      capability_fingerprint: capability.fingerprint,
      calibration_fingerprint: capability.calibration?.fingerprint ?? null,
    },
  };
}

export function verificationStatusOf(equivalent: boolean | null | undefined, note?: string): VerificationStatus {
  if (equivalent === true) return "checked";
  if (equivalent === false) return "failed";
  const text = note ?? "";
  if (/ancilla/i.test(text)) return "partial";
  if (/limited to|not attempted|disabled/i.test(text)) return "unsupported";
  if (/unavailable|threw|error|crash/i.test(text)) return "unsupported";
  return "unsupported";
}

/** Evidence levels used by the envelope policy. Failed checks always reject. */
export function assertVerificationPolicy(status: VerificationStatus, minimum: VerificationStatus) {
  const level: Record<VerificationStatus, number> = { failed: -1, unsupported: 0, partial: 1, provider_validated: 2, checked: 3, proved: 4 };
  if (status === "failed" || minimum === "failed" || level[status] < level[minimum]) {
    throw new Error(`Verification policy requires ${minimum}; artifact evidence is ${status}.`);
  }
}

export function buildBundle(input: {
  envelope: ExecutionEnvelope;
  backendId: string;
  payload: string;
  mediaType: string;
  decodeMap: DecodeMap;
  capability: CapabilityProfile;
  compiler: { name: string; version: string; optimization_level: number; seed: number };
  verification: VerificationReport;
  metrics: ExecutionBundle["metrics"];
  quoteBinding: QuoteBinding;
  loweringProofs?: string[];
}): ExecutionBundle {
  assertVerificationPolicy(input.verification.status, input.envelope.policy.verification.minimum_status);
  const body = {
    schema_version: BUNDLE_SCHEMA,
    envelope_id: input.envelope.id,
    backend_id: input.backendId,
    payload: input.payload,
    media_type: input.mediaType,
    decode_map: input.decodeMap,
    provenance: {
      adapter: { name: input.capability.adapter.name, version: ADAPTER_VERSION },
      compiler: input.compiler,
      capability_fingerprint: input.capability.fingerprint,
      calibration_fingerprint: input.capability.calibration?.fingerprint ?? null,
      lowering_proofs: input.loweringProofs ?? [],
    },
    verification: input.verification,
    metrics: input.metrics,
    quote_binding: input.quoteBinding,
  };
  return { ...body, id: jcsHash(body) };
}

export const FRONTEND = { name: "qee-qasm", version: FRONTEND_VERSION };
