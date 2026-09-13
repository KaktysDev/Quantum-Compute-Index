import { BraketClient, GetDeviceCommand } from "@aws-sdk/client-braket";
import type { Backend } from "./types";

const BRAKET_TARGETS: Record<string, { arn: string; region: string }> = {
  "iqm-garnet": { arn: "arn:aws:braket:eu-north-1::device/qpu/iqm/Garnet", region: "eu-north-1" },
  "rigetti-ankaa-3": { arn: "arn:aws:braket:us-west-1::device/qpu/rigetti/Ankaa-3", region: "us-west-1" },
};

interface BraketCapabilities {
  paradigm?: {
    connectivity?: {
      fullyConnected?: boolean;
      connectivityGraph?: Record<string, string[]>;
    };
    nativeGateSet?: string[];
  };
}

interface CachedTopology {
  connectivity: Backend["connectivity"];
  couplingMap?: number[][];
}

/** Coupling maps are hardware topology; they do not change with queue or price. */
const TARGET_TTL_MS = Math.max(5_000, Number(process.env.QROUTER_PROVIDER_TARGET_TTL_MS ?? 30 * 60_000));
const TARGET_ERROR_TTL_MS = Math.max(1_000, Number(process.env.QROUTER_PROVIDER_TARGET_ERROR_TTL_MS ?? 15_000));

const topologyCache = new Map<string, { expiresAt: number; value: CachedTopology }>();
const topologyErrors = new Map<string, { expiresAt: number; error: Error }>();
const topologyInflight = new Map<string, Promise<CachedTopology>>();

export function resetProviderTargetCache() {
  topologyCache.clear();
  topologyErrors.clear();
  topologyInflight.clear();
}

function applyTopology(backend: Backend, topology: CachedTopology): Backend {
  return {
    ...backend,
    connectivity: topology.connectivity,
    couplingMap: topology.couplingMap,
    basisGates: backend.basisGates,
  };
}

function couplingMap(graph: Record<string, string[]> = {}) {
  const edges = new Set<string>();
  for (const [source, targets] of Object.entries(graph)) {
    for (const target of targets) {
      edges.add(`${Number(source)},${Number(target)}`);
      edges.add(`${Number(target)},${Number(source)}`);
    }
  }
  return [...edges].map((edge) => edge.split(",").map(Number));
}

async function fetchBraketTopology(backend: Backend, braket: { arn: string; region: string }): Promise<CachedTopology> {
  const device = await new BraketClient({ region: braket.region }).send(new GetDeviceCommand({ deviceArn: braket.arn }));
  const capabilities = JSON.parse(device.deviceCapabilities ?? "{}") as BraketCapabilities;
  const connectivity = capabilities.paradigm?.connectivity;
  if (connectivity?.fullyConnected) return { connectivity: "all-to-all" };
  const map = couplingMap(connectivity?.connectivityGraph);
  if (!map.length) throw new Error(`Amazon Braket did not return a coupling graph for ${backend.displayName}.`);
  return { connectivity: "custom", couplingMap: map };
}

export async function resolveProviderTarget(backend: Backend): Promise<Backend> {
  // IBM targets resolve inside the Qiskit compiler worker via QiskitRuntimeService.
  if (backend.connectivity !== "target" || backend.provider.toLowerCase() === "ibm") return backend;

  const braket = BRAKET_TARGETS[backend.id];
  if (!braket) {
    throw new Error(`${backend.displayName} requires a provider target adapter before hardware-aware compilation.`);
  }

  const cached = topologyCache.get(backend.id);
  if (cached && cached.expiresAt > Date.now()) return applyTopology(backend, cached.value);
  const failed = topologyErrors.get(backend.id);
  if (failed && failed.expiresAt > Date.now()) throw failed.error;

  const pending = topologyInflight.get(backend.id);
  if (pending) return applyTopology(backend, await pending);

  const work = fetchBraketTopology(backend, braket).then((value) => {
    topologyCache.set(backend.id, { expiresAt: Date.now() + TARGET_TTL_MS, value });
    topologyErrors.delete(backend.id);
    topologyInflight.delete(backend.id);
    return value;
  }).catch((error) => {
    topologyInflight.delete(backend.id);
    const wrapped = error instanceof Error ? error : new Error(String(error));
    topologyErrors.set(backend.id, { expiresAt: Date.now() + TARGET_ERROR_TTL_MS, error: wrapped });
    throw wrapped;
  });
  topologyInflight.set(backend.id, work);
  return applyTopology(backend, await work);
}
