export type InputFormat = "openqasm2" | "openqasm3";
export type RoutingMode = "balanced" | "cost" | "speed" | "quality";
export type JobStatus = "created" | "analyzing" | "quoted" | "awaiting_payment" | "funds_reserved" | "queued" | "submitted" | "processing" | "completed" | "failed" | "cancellation_requested" | "cancelled";

export interface CircuitAnalysis {
  qubits: number; classicalBits: number; depth: number; gates: number;
  twoQubitGates: number; measurements: number; gateCounts: Record<string, number>;
  complexity: "light" | "medium" | "heavy"; normalizedQasm2: string;
}

export interface Backend {
  id: string; provider: string; displayName: string; kind: "qpu" | "simulator";
  status: "online" | "degraded" | "offline"; qubits: number; clops: number;
  queueSeconds: number; fidelity: number; reliability: number; pricePerNqh: number;
  taskMinimum: number; description: string; region?: string; available: boolean;
  backendName?: string; basisGates: string[];
  connectivity: "target" | "all-to-all" | "custom";
  couplingMap?: number[][];
  executionModel?: "gate" | "photonic";
}

export interface TranspilationMetrics {
  qubits: number; classicalBits: number; depth: number; gates: number;
  twoQubitGates: number; operations: Record<string, number>;
}

export interface TranspilationResult {
  qasm: string; artifactQasm?: string;
  providerProgram?: { format: "qpy"; data: string };
  backendId: string; compiler: "qiskit" | "local";
  optimizationLevel: number; seedTranspiler: number;
  before: TranspilationMetrics; after: TranspilationMetrics;
  layout: Record<string, unknown> | null; equivalent: boolean | null;
  verificationNote: string | null;
  improvement: { depthPercent: number; gatePercent: number };
  target: Record<string, unknown>;
}

export interface RoutingConstraints {
  maxCost?: number; maxQueueSeconds?: number; minFidelity?: number;
  kind?: "qpu" | "simulator"; providers?: string[]; excludeProviders?: string[];
}

export interface RouteCandidate {
  backend: Backend; compatible: boolean; rejectionReasons: string[];
  score: number; estimatedProviderCost: number; estimatedNqh: number;
}

export interface RouteDecision {
  selected: Backend; candidates: RouteCandidate[]; mode: RoutingMode;
  explanation: string[]; qciSnapshotId: number | null; qciTimestamp: string;
}

export interface Quote {
  providerCost: number; transpilerFee: number; platformFee: number; total: number;
  currency: "usd"; expiresAt: string; rateSnapshot: Record<string, unknown>;
}
