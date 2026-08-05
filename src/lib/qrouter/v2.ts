import { createHash, randomUUID } from "crypto";
import { z } from "zod";
import type { RoutingConstraints, RoutingMode } from "./types";

export const V2_GROUP_STATUSES = ["queued", "running", "awaiting_payment", "completed", "failed", "cancelled"] as const;
export type V2GroupStatus = (typeof V2_GROUP_STATUSES)[number];

export interface CircuitResource {
  id: string;
  organization_id: string;
  name: string | null;
  format: "openqasm2" | "openqasm3";
  source_hash: string;
  analysis: Record<string, unknown>;
  created_at: string;
  expires_at: string | null;
  released_at: string | null;
}

export interface ExecutionTarget {
  key: string;
  target?: string;
  shots?: number;
  routing_mode?: RoutingMode;
  optimization_level?: number;
  failover?: boolean;
  max_attempts?: number;
  timeout_seconds?: number;
  constraints?: RoutingConstraints;
}

export interface ExecutionGroup {
  id: string;
  circuit_id: string;
  organization_id: string;
  status: V2GroupStatus;
  metadata: Record<string, string>;
  executions: Array<Record<string, unknown>>;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  error: Record<string, unknown> | null;
}

const constraintsSchema = z.object({
  maxCost: z.number().positive().optional(),
  maxQueueSeconds: z.number().int().nonnegative().optional(),
  minFidelity: z.number().min(0).max(1).optional(),
  kind: z.enum(["qpu", "simulator"]).optional(),
  providers: z.array(z.string()).max(25).optional(),
  excludeProviders: z.array(z.string()).max(25).optional(),
}).default({});

export const createCircuitSchema = z.object({
  name: z.string().trim().min(1).max(120).nullish().transform((value) => value ?? undefined),
  circuit: z.string().min(1).max(256_000),
  format: z.enum(["openqasm2", "openqasm3"]).default("openqasm2"),
}).strict();

export const createExecutionGroupSchema = z.object({
  circuit_id: z.string().uuid(),
  metadata: z.record(z.string().max(64), z.string().max(500)).refine((value) => Object.keys(value).length <= 50, "Metadata is limited to 50 entries.").default({}),
  executions: z.array(z.object({
    key: z.string().trim().min(1).max(64),
    target: z.string().min(1).max(120).default("auto"),
    shots: z.number().int().min(1).max(1_000_000).default(1024),
    routing_mode: z.enum(["balanced", "cost", "speed", "quality"]).default("balanced"),
    optimization_level: z.number().int().min(0).max(3).default(2),
    failover: z.boolean().default(true),
    max_attempts: z.number().int().min(1).max(5).default(3),
    timeout_seconds: z.number().int().min(60).max(604_800).default(7_200),
    constraints: constraintsSchema,
  }).strict()).min(1).max(25),
}).strict().superRefine((value, context) => {
  const keys = value.executions.map((execution) => execution.key);
  if (new Set(keys).size !== keys.length) {
    context.addIssue({ code: "custom", path: ["executions"], message: "Each execution key must be unique per job." });
  }
});

export type CreateCircuitInput = z.infer<typeof createCircuitSchema>;
export type CreateExecutionGroupInput = z.infer<typeof createExecutionGroupSchema>;

export function hashRequest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function idempotencyKey(request: Request) {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key || key.length < 8 || key.length > 255) return null;
  return key;
}

export function newV2Id() {
  return randomUUID();
}
