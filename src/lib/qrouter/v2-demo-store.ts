import type { CircuitResource, ExecutionGroup } from "./v2";

type DemoCircuit = CircuitResource & { source: string; idempotency_key: string; request_hash: string };
type DemoGroup = ExecutionGroup & { idempotency_key: string; request_hash: string };

const state = globalThis as typeof globalThis & {
  __qrouterV2Circuits?: Map<string, DemoCircuit>;
  __qrouterV2Groups?: Map<string, DemoGroup>;
};

export const demoV2Circuits = state.__qrouterV2Circuits ?? new Map<string, DemoCircuit>();
export const demoV2Groups = state.__qrouterV2Groups ?? new Map<string, DemoGroup>();
if (process.env.NODE_ENV !== "production") {
  state.__qrouterV2Circuits = demoV2Circuits;
  state.__qrouterV2Groups = demoV2Groups;
}

export type { DemoCircuit, DemoGroup };
