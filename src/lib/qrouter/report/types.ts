/**
 * Public job-results report types. Every field here is safe to ship to the
 * console, PDF, and follow-up chat: no QASM, native payloads, providerResult,
 * or secrets.
 */

export const REPORT_SCHEMA = "qrouter.job-report/1" as const;

export type BitstringRow = {
  bitstring: string;
  count: number | null;
  probability: number | null;
};

export type MeasurementPair = { qubit: number; clbit: number };

export type ResultAnalytics = {
  available: boolean;
  /** Honest empty/pending copy when there is nothing to plot. */
  reason?: string;
  shotsRequested: number | null;
  shotsObserved: number | null;
  shotsMatch: boolean | null;
  distinctStates: number;
  top: BitstringRow[];
  histogram: BitstringRow[];
  /** Shannon entropy of the shot histogram, only from real (non-synthetic) counts. */
  shannonEntropyBits: number | null;
  /** Entropy of the probability map when counts are missing or synthetic. */
  probabilityEntropyBits: number | null;
  maxProbability: number | null;
  mostProbable: string | null;
  countsAreSynthetic: boolean;
  probabilitiesPresent: boolean;
  bitOrder?: string;
  sourceBitOrder?: string;
  layoutApplied?: boolean;
  measurementMap: MeasurementPair[];
  layoutMapped: number | null;
  /** Present only when the stored result metadata already has a numeric fidelity. */
  fidelity: number | null;
  /** Present only when the stored result metadata already has a numeric stderr. */
  stderr: number | null;
  /** Present only when the job stored an expected / ideal distribution. */
  expected: BitstringRow[] | null;
  notes: string[];
};

export type ReportJobMeta = {
  id: string;
  name: string | null;
  status: string;
  backendId: string;
  backendName: string;
  backendKind: string | null;
  shots: number | null;
  qubits: number | null;
  depth: number | null;
  complexity: string | null;
  createdAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  cost: number | null;
};

export type ReportTranspile = {
  depthFrom: number | null;
  depthTo: number | null;
  gatesFrom: number | null;
  gatesTo: number | null;
  equivalent: boolean | null;
  verification: string | null;
};

export type ReportNarrative = {
  text: string;
  source: "qci-engine" | "gemini" | "inference";
  model: string;
  generatedAt: string;
  resultHash: string;
};

export type JobReportContext = {
  schema: typeof REPORT_SCHEMA;
  hash: string;
  generatedAt: string;
  job: ReportJobMeta;
  analytics: ResultAnalytics;
  transpile: ReportTranspile | null;
  narrative: ReportNarrative | null;
};

export type ReportAskTurn = {
  question: string;
  answer: string;
};
