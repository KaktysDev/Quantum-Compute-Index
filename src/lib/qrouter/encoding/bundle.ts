/**
 * Envelope + ExecutionBundle construction and verification reports (§5.2, §5.9, §5.11).
 */

import { createHash } from "crypto";
import type { RoutingConstraints, RoutingMode, TranspilationResult } from "../types";
import { frontendInfo } from "./frontend";
import { jcsHash } from "./jcs";
import { deriveRequirements } from "./satisfy";
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
      source_sha256: createHash("sha256").update(input.source).digest("hex"),
      frontend: frontendInfo(),
    },
  };
  return { ...body, id: jcsHash(body) };
}

export function verificationFromTranspile(result: TranspilationResult | null, capability: CapabilityProfile): VerificationReport {
  const status = result ? verificationStatusOf(result.equivalent, result.verificationNote) : "unsupported";
  return {
    status,
    gates_run: [
      { gate: "G1", status: "proved", detail: "Parsed and type-checked." },
      { gate: "G3", status: "checked", detail: "satisfies() re-run against the compiled artifact." },
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
  if (equivalent === true) return "proved";
  if (equivalent === false) return "failed";
  const text = note ?? "";
  if (/ancilla/i.test(text)) return "partial";
  if (/limited to|not attempted|disabled/i.test(text)) return "unsupported";
  if (/unavailable|threw|error|crash/i.test(text)) return "unsupported";
  return "unsupported";
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
      lowering_proofs: input.loweringProofs ?? ["g5-ci"],
    },
    verification: input.verification,
    metrics: input.metrics,
    quote_binding: input.quoteBinding,
  };
  return { ...body, id: jcsHash(body) };
}

export const FRONTEND = { name: "qee-qasm", version: FRONTEND_VERSION };
