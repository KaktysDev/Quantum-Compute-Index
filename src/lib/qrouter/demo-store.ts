import type { CircuitAnalysis, JobStatus, Quote, RouteDecision, TranspilationResult } from "./types";

export type StoredJobAnalysis = CircuitAnalysis & {
  transpilation?: Omit<TranspilationResult, "providerProgram">;
};

export interface StoredJob {
  id: string;
  organization_id: string;
  name: string | null;
  input_format: string;
  source: string;
  shots: number;
  target: string;
  routing_mode: string;
  status: JobStatus;
  selected_backend_id: string;
  analysis: StoredJobAnalysis;
  route_decision: RouteDecision;
  quote: Quote;
  result: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

const state = globalThis as typeof globalThis & { __qrouterJobs?: Map<string, StoredJob> };
export const demoJobs = state.__qrouterJobs ?? new Map<string, StoredJob>();
if (process.env.NODE_ENV !== "production") state.__qrouterJobs = demoJobs;

export const DEMO_BALANCE = 10;
