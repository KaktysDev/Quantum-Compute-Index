import { BraketClient, GetDeviceCommand } from "@aws-sdk/client-braket";
import type { Backend } from "./types";

const BRAKET_TARGETS: Record<string, { arn: string; region: string }> = {
  "iqm-garnet": { arn: "arn:aws:braket:eu-north-1::device/qpu/iqm/Garnet", region: "eu-north-1" },
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

export async function resolveProviderTarget(backend: Backend): Promise<Backend> {
  if (backend.connectivity !== "target" || backend.provider === "IBM") return backend;

  const braket = BRAKET_TARGETS[backend.id];
  if (braket) {
    const device = await new BraketClient({ region: braket.region }).send(new GetDeviceCommand({ deviceArn: braket.arn }));
    const capabilities = JSON.parse(device.deviceCapabilities ?? "{}") as BraketCapabilities;
    const connectivity = capabilities.paradigm?.connectivity;
    if (connectivity?.fullyConnected) return { ...backend, connectivity: "all-to-all" };
    const map = couplingMap(connectivity?.connectivityGraph);
    if (!map.length) throw new Error(`Amazon Braket did not return a coupling graph for ${backend.displayName}.`);
    return {
      ...backend,
      connectivity: "custom",
      couplingMap: map,
      basisGates: backend.basisGates,
    };
  }

  throw new Error(`${backend.displayName} requires a provider target adapter before hardware-aware compilation.`);
}
