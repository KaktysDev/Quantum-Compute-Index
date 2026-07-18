export type InputFormat = "openqasm2" | "openqasm3";
export type RoutingMode = "balanced" | "cost" | "speed" | "quality";
export type BackendKind = "qpu" | "simulator";

export type JobStatus =
  | "created"
  | "analyzing"
  | "quoted"
  | "awaiting_payment"
  | "funds_reserved"
  | "queued"
  | "dispatching"
  | "submitted"
  | "processing"
  | "completed"
  | "failed"
  | "cancellation_requested"
  | "cancelled";

export interface CircuitAnalysis {
  qubits: number;
  classicalBits: number;
  depth: number;
  gates: number;
  twoQubitGates: number;
  measurements: number;
  gateCounts: Record<string, number>;
  complexity: "light" | "medium" | "heavy";
  normalizedQasm2: string;
}

export interface Backend {
  id: string;
  provider: string;
  backendName?: string;
  displayName: string;
  kind: BackendKind;
  status: "online" | "degraded" | "offline";
  qubits: number;
  nativeGates: string[];
  basisGates: string[];
  connectivity: "all-to-all" | "linear" | "heavy-hex" | "target" | "custom";
  couplingMap?: number[][];
  queueSeconds: number;
  fidelity: number;
  reliability: number;
  pricePerShot: number;
  pricePerTask: number;
  pricePerNqh?: number;
  clops?: number;
  description: string;
  region?: string;
  available: boolean;
  health?: { reachable: boolean; consecutiveFailures: number; detail: string; checkedAt: string };
}

export interface RoutingConstraints {
  maxCost?: number;
  maxQueueSeconds?: number;
  minFidelity?: number;
  kind?: BackendKind;
  providers?: string[];
  excludeProviders?: string[];
}

export interface RouteCandidate {
  backend: Backend;
  compatible: boolean;
  rejectionReasons: string[];
  score: number;
  estimatedProviderCost: number;
  estimatedNqh: number;
}

export interface RouteDecision {
  selected: Backend;
  candidates: RouteCandidate[];
  mode: RoutingMode;
  explanation: string[];
  qciSnapshotId?: number | null;
  qciTimestamp?: string;
}

export interface Quote {
  providerCost: number;
  transpilerFee: number;
  platformFee: number;
  total: number;
  currency: "usd";
  expiresAt: string;
  rateSnapshot: Record<string, unknown>;
}

export interface TranspilationMetrics {
  qubits: number;
  classicalBits: number;
  depth: number;
  gates: number;
  twoQubitGates: number;
  operations: Record<string, number>;
}

export interface TranspilationResult {
  qasm: string;
  artifactQasm?: string;
  providerProgram?: string;
  backendId: string;
  compiler: "local" | "qiskit";
  optimizationLevel: number;
  seedTranspiler: number;
  before: TranspilationMetrics;
  after: TranspilationMetrics;
  layout: Record<string, unknown> | null;
  equivalent: boolean | null;
  verificationNote?: string;
  improvement: {
    depthPercent: number;
    gatePercent: number;
  };
  target: {
    backendId: string;
    basisGates: string[];
    connectivity: Backend["connectivity"];
  };
}
