import { z } from "zod";

export const createJobSchema = z.object({
  name: z.string().trim().max(120).optional(),
  circuit: z.string().min(1).max(256_000),
  format: z.enum(["openqasm2", "openqasm3"]).default("openqasm2"),
  shots: z.number().int().min(1).max(1_000_000).default(1024),
  target: z.string().default("auto"),
  routing_mode: z.enum(["balanced", "cost", "speed", "quality"]).default("balanced"),
  optimization_level: z.number().int().min(0).max(3).default(2),
  constraints: z.object({
    maxCost: z.number().positive().optional(),
    maxQueueSeconds: z.number().int().nonnegative().optional(),
    minFidelity: z.number().min(0).max(1).optional(),
    kind: z.enum(["qpu", "simulator"]).optional(),
    providers: z.array(z.string()).optional(),
    excludeProviders: z.array(z.string()).optional(),
  }).default({}),
});
