/**
 * Quantum Execution Envelope types — qee-1.0.0-draft §5.
 * Discriminated workloads, capability satisfaction, exact artifacts, typed results.
 */

type RoutingMode = "balanced" | "cost" | "speed" | "quality";
type RoutingConstraints = {
  maxCost?: number;
  maxQueueSeconds?: number;
  minFidelity?: number;
  kind?: "qpu" | "simulator";
  providers?: string[];
  excludeProviders?: string[];
};

export const QEE_SCHEMA = "qee/1" as const;
export const REQ_SCHEMA = "req/1" as const;
export const CAP_SCHEMA = "cap/1" as const;
export const BUNDLE_SCHEMA = "bundle/1" as const;
export const RES_SCHEMA = "res/1" as const;
export const ADAPTER_VERSION = "qee-1.0.0";
export const FRONTEND_VERSION = "qee-frontend-1.0.0";
export const PLATFORM_BIT_ORDER = "q0_right" as const;

export type WorkloadKind =
  | "gate"
  | "dynamic"
  | "timed"
  | "analog"
  | "annealing"
  | "photonic"
  | "primitive"
  | "estimation";

export type VerificationStatus =
  | "proved"
  | "checked"
  | "provider_validated"
  | "partial"
  | "unsupported"
  | "failed";

export type BitOrder = "q0_left" | "q0_right";
export type QuoteBinding = "binding" | "indicative";

export interface QubitRegister { name: string; size: number }
export interface ClassicalRegister { name: string; size: number }
export type ParamExpr = { kind: "number"; value: number } | { kind: "symbol"; expression: string };
export interface ParamDecl { name: string; expression?: string }
export type Modifier = { kind: "ctrl"; controls: QubitRef[] } | { kind: "inv" } | { kind: "pow"; power: ParamExpr };
export interface QubitRef { register: string; index: number | null }
export interface ClbitRef { register: string; index: number | null }

export type Stmt =
  | { op: "gate"; name: string; params: ParamExpr[]; qubits: QubitRef[]; modifiers: Modifier[] }
  | { op: "measure"; qubit: QubitRef; clbit: ClbitRef }
  | { op: "reset"; qubit: QubitRef }
  | { op: "barrier"; qubits: QubitRef[] }
  | { op: "delay"; duration: string; qubits: QubitRef[] }
  | { op: "if"; cond: string; then: Stmt[]; else?: Stmt[] }
  | { op: "for"; var: string; range: string; body: Stmt[] }
  | { op: "while"; cond: string; body: Stmt[] }
  | { op: "switch"; subject: string; cases: Array<{ match: string; body: Stmt[] }> }
  | { op: "call"; subroutine: string; args: string[] };

export interface GateDef {
  name: string;
  params: string[];
  args: string[];
  body: Stmt[];
}

export interface GateProgram {
  qubits: QubitRegister[];
  clbits: ClassicalRegister[];
  params: ParamDecl[];
  body: Stmt[];
  gate_defs: Record<string, GateDef>;
}

export type Workload =
  | { kind: "gate"; program: GateProgram; shots: number }
  | { kind: "dynamic"; program: GateProgram; shots: number }
  | { kind: "timed"; program: GateProgram; shots: number }
  | { kind: "analog"; program: Record<string, unknown>; shots: number }
  | { kind: "annealing"; problem: Record<string, unknown>; reads: number }
  | { kind: "photonic"; program: Record<string, unknown>; shots: number }
  | { kind: "primitive"; pubs: Array<Record<string, unknown>> }
  | { kind: "estimation"; program: GateProgram; estimator: Record<string, unknown> };

export interface InstructionRequirement {
  opid: string;
  name: string;
  arity: { qubits: number; params: number };
}

export interface RequirementSet {
  schema_version: typeof REQ_SCHEMA;
  workload_kind: WorkloadKind;
  qubits: number;
  clbits: number;
  instructions: InstructionRequirement[];
  connectivity: { pairs: [number, number][]; needs_routing: boolean };
  classical: {
    mid_circuit_measurement: boolean;
    feedback: boolean;
    control_flow: Array<"if" | "for" | "while" | "switch">;
  };
  timing: { explicit_delays: boolean; stretch: boolean; pulse_level: boolean };
  results: string[];
  limits: { shots: number; depth: number; ops: number; batch_size: number };
}

export interface InstructionCapability {
  opid: string;
  name: string;
  provider_token: string;
  arity: { qubits: number; params: number };
}

export interface CapabilityProfile {
  schema_version: typeof CAP_SCHEMA;
  backend_id: string;
  adapter: { name: string; version: string };
  source: "provider_api" | "static_fallback";
  fetched_at: string;
  staleness: { ttl_seconds: number; is_stale: boolean };
  workload_kinds: WorkloadKind[];
  instructions: InstructionCapability[];
  connectivity: { kind: "all-to-all" | "coupling_map"; coupling_map?: [number, number][] };
  classical: {
    mid_circuit_measurement: boolean;
    feedback: boolean;
    control_flow: Array<"if" | "for" | "while" | "switch">;
  };
  timing: { explicit_delays: boolean; stretch: boolean; pulse_level: boolean };
  result_types: string[];
  limits: { max_qubits: number; max_shots: number; max_depth?: number; max_ops?: number; max_batch?: number };
  calibration: { fingerprint: string; measured_at: string } | null;
  provider_schema_version: string;
  fingerprint: string;
  routable: boolean;
  routing_note?: string;
}

export interface SatisfactionFailure {
  code: string;
  message: string;
  requirement?: string;
}

export type Verdict =
  | { ok: true; notes: string[] }
  | { ok: false; failures: SatisfactionFailure[] };

export interface ExecutionEnvelope {
  schema_version: typeof QEE_SCHEMA;
  id: string;
  created_at: string;
  workload: Workload;
  requirements: RequirementSet;
  policy: {
    routing_mode: RoutingMode;
    constraints: RoutingConstraints;
    failover: { enabled: boolean; max_attempts: number };
    verification: { minimum_status: VerificationStatus };
  };
  provenance: {
    source_sha256: string;
    frontend: { name: string; version: string };
  };
}

export interface DecodeMap {
  bit_order: BitOrder;
  registers: Array<{ name: string; width: number; offset: number }>;
  measurement_map: Array<{ qubit: number; clbit: number }>;
  layout: { logical_to_physical: Record<number, number>; routing_permutation: number[] } | null;
  result_types: string[];
}

export interface VerificationReport {
  status: VerificationStatus;
  gates_run: Array<{ gate: string; status: VerificationStatus; detail: string }>;
  bound_to: { compiler_version: string; capability_fingerprint: string; calibration_fingerprint: string | null };
}

export interface ExecutionBundle {
  schema_version: typeof BUNDLE_SCHEMA;
  id: string;
  envelope_id: string;
  backend_id: string;
  payload: string;
  media_type: string;
  decode_map: DecodeMap;
  provenance: {
    adapter: { name: string; version: string };
    compiler: { name: string; version: string; optimization_level: number; seed: number };
    capability_fingerprint: string;
    calibration_fingerprint: string | null;
    lowering_proofs: string[];
  };
  verification: VerificationReport;
  metrics: { qubits: number; depth: number; ops: Record<string, number>; two_qubit_ops: number };
  quote_binding: QuoteBinding;
}

export interface SyntheticFlag {
  field: string;
  reason: string;
  method: string;
}

export type ResultData =
  | { type: "samples"; register: string; shots: number; bitstrings: string[] }
  | { type: "counts"; register: string; shots: number; counts: Record<string, number> }
  | { type: "probabilities"; register: string; probabilities: Record<string, number> }
  | { type: "quasi"; register: string; quasi: Record<string, number>; mitigation: string }
  | { type: "expectation"; observable: string; value: number; variance?: number; stderr?: number }
  | { type: "gradient"; observable: string; values: number[]; parameters: string[] }
  | { type: "statevector"; amplitudes: string }
  | { type: "density_matrix"; matrix: string }
  | { type: "annealing"; samples: Array<{ sample: Record<string, number>; energy: number; num_occurrences: number; chain_break_fraction?: number }> }
  | { type: "analog"; shots: number; site_measurements: string }
  | { type: "photon_pattern"; patterns: Array<{ modes: number[]; count: number }> };

export interface ResultSet {
  schema_version: typeof RES_SCHEMA;
  bundle_id: string;
  backend_id: string;
  data: ResultData[];
  provenance: {
    decoder_version: string;
    bit_order: BitOrder;
    source_bit_order: BitOrder;
    layout_applied: boolean;
    synthetic: SyntheticFlag[];
  };
  raw: Record<string, unknown>;
}

export type EncodingStageId = "analyze" | "score" | "transpile" | "route" | "execute";
export type EncodingStageStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface EncodingStage {
  id: EncodingStageId;
  label: string;
  paper: string;
  status: EncodingStageStatus;
  detail: string;
}

export interface EncodingTrace {
  schema_version: typeof QEE_SCHEMA;
  envelope_id: string;
  workload_kind: WorkloadKind;
  frontend: { name: string; version: string };
  stages: EncodingStage[];
  requirements: {
    qubits: number;
    clbits: number;
    instructions: string[];
    control_flow: string[];
    mid_circuit_measurement: boolean;
    feedback: boolean;
  };
  selected_bundle?: {
    id: string;
    backend_id: string;
    media_type: string;
    payload?: string;
    bit_order: BitOrder;
    verification: VerificationStatus;
    quote_binding: QuoteBinding;
    metrics: ExecutionBundle["metrics"];
    decode_map: DecodeMap;
  };
  compiled: Array<{
    backend_id: string;
    bundle_id: string;
    quote_binding: QuoteBinding;
    verification: VerificationStatus;
  }>;
}

export class EncodingError extends Error {
  constructor(message: string, public details: string[] = []) {
    super(message);
    this.name = "EncodingError";
  }
}
