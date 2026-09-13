import { afterEach, describe, expect, it, vi } from "vitest";
import { BraketClient } from "@aws-sdk/client-braket";
import { sampleSnapshot } from "@/lib/qci/sample";
import * as store from "@/lib/qci/store";
import { POLICIES, rankDevices } from "@/lib/qci/v2/routing";
import type { DeviceDerived } from "@/lib/qci/v2/types";
import { analyzeCircuit } from "@/lib/qrouter/analyze";
import { BackendUnavailableError } from "@/lib/qrouter/availability";
import { BACKENDS, getBackend, withQciSnapshot } from "@/lib/qrouter/catalog";
import { applyProviderHealth, loadPersistedBackendHealth } from "@/lib/qrouter/providerHealth";
import * as healthMod from "@/lib/qrouter/providerHealth";
import { resetProviderTargetCache, resolveProviderTarget } from "@/lib/qrouter/providerTargets";
import { routeCircuit } from "@/lib/qrouter/route";
import { loadPublicRoutingContext, loadRoutingContext, resetRoutingContextCache } from "@/lib/qrouter/routingContext";
import * as admin from "@/lib/supabase/admin";
import type { Backend } from "@/lib/qrouter/types";

const BELL = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
measure q -> c;`;

const analysis = analyzeCircuit(BELL, "openqasm2");

function qpus(): Backend[] {
  return BACKENDS.filter((backend) => backend.kind === "qpu").map((backend) => ({
    ...backend,
    available: true,
    status: "online",
  }));
}

function policyPool(): Backend[] {
  const base = {
    ...BACKENDS[0],
    kind: "qpu" as const,
    available: true,
    status: "online" as const,
    qubits: 32,
    pricePerNqh: undefined,
    reliability: 0.95,
  };
  return [
    { ...base, id: "cheap", displayName: "Cheap", provider: "a", queueSeconds: 8_000, fidelity: 0.90, pricePerShot: 0.00001, pricePerTask: 0.01 },
    { ...base, id: "fast", displayName: "Fast", provider: "b", queueSeconds: 2, fidelity: 0.91, pricePerShot: 0.02, pricePerTask: 8 },
    { ...base, id: "precise", displayName: "Precise", provider: "c", queueSeconds: 4_000, fidelity: 0.999, pricePerShot: 0.008, pricePerTask: 3 },
  ];
}

function device(id: string, over: Partial<DeviceDerived> = {}): DeviceDerived {
  return {
    id,
    provider: "test",
    device: id,
    modality: "superconducting",
    region: "us-east-1",
    pricePerHour: 100,
    priceBasis: "reservation-hour",
    effectiveWidth: 16,
    capability: 1,
    qualityAdjustedPrice: 100,
    weight: 0.5,
    linkWeight: 0.5,
    fresh: true,
    staleDays: 0,
    inMatchedSample: true,
    qualityTier: "primary",
    queueSeconds: 60,
    ...over,
  };
}

describe("routeCircuit policies and constraints", () => {
  it("selects different QPUs under cost, speed, and quality", () => {
    const backends = policyPool();
    const cost = routeCircuit({ backends, analysis, shots: 1024, target: "auto", mode: "cost" });
    const speed = routeCircuit({ backends, analysis, shots: 1024, target: "auto", mode: "speed" });
    const quality = routeCircuit({ backends, analysis, shots: 1024, target: "auto", mode: "quality" });
    const balanced = routeCircuit({ backends, analysis, shots: 1024, target: "auto", mode: "balanced" });

    expect(cost.selected.id).toBe("cheap");
    expect(speed.selected.id).toBe("fast");
    expect(quality.selected.id).toBe("precise");
    expect(balanced.candidates.filter((item) => item.compatible)).toHaveLength(3);
    expect(new Set(backends.map((item) => routeCircuit({ backends, analysis, shots: 1024, target: item.id, mode: "balanced" }).selected.id))).toEqual(new Set(["cheap", "fast", "precise"]));
  });

  it("honours kind, provider, fidelity, queue, and cost constraints", () => {
    const backends = BACKENDS.map((backend) => ({ ...backend, available: true, status: "online" as const }));
    expect(routeCircuit({
      backends, analysis, shots: 128, target: "auto", mode: "balanced",
      constraints: { kind: "simulator" },
    }).selected.kind).toBe("simulator");

    expect(routeCircuit({
      backends, analysis, shots: 128, target: "auto", mode: "cost",
      constraints: { providers: ["ibm"] },
    }).selected.id).toBe("ibm-brisbane");

    expect(routeCircuit({
      backends, analysis, shots: 128, target: "auto", mode: "speed",
      constraints: { excludeProviders: ["qci"] },
    }).selected.provider).not.toBe("qci");

    const fidelity = routeCircuit({
      backends, analysis, shots: 128, target: "auto", mode: "quality",
      constraints: { minFidelity: 0.995 },
    });
    expect(fidelity.candidates.filter((item) => item.compatible).every((item) => item.backend.fidelity >= 0.995)).toBe(true);

    const queue = routeCircuit({
      backends, analysis, shots: 128, target: "auto", mode: "speed",
      constraints: { maxQueueSeconds: 10 },
    });
    expect(queue.selected.queueSeconds).toBeLessThanOrEqual(10);

    expect(() => routeCircuit({
      backends, analysis, shots: 1024, target: "auto", mode: "balanced",
      constraints: { maxCost: 0.0001 },
    })).toThrow(/No backend can run this workload/);
  });

  it("rejects an oversized circuit and an unknown target", () => {
    const backends = qpus();
    const huge = { ...analysis, qubits: 10_000 };
    expect(() => routeCircuit({ backends, analysis: huge, shots: 8, target: "auto", mode: "balanced" })).toThrow(/No backend can run this workload/);
    expect(() => routeCircuit({ backends, analysis, shots: 8, target: "not-a-backend", mode: "balanced" })).toThrow(/Unknown backend/);
  });

  it("keeps estimated NQH identical across candidates", () => {
    const decision = routeCircuit({ backends: qpus(), analysis, shots: 2048, target: "auto", mode: "balanced" });
    const values = new Set(decision.candidates.map((item) => item.estimatedNqh));
    expect(values.size).toBe(1);
  });

  it("still offers alternatives when a pinned QPU is unavailable", () => {
    try {
      routeCircuit({
        backends: BACKENDS.map((backend) => backend.id === "ibm-brisbane" ? { ...backend, available: false } : { ...backend, available: true }),
        analysis, shots: 64, target: "ibm-brisbane", mode: "balanced",
      });
      expect.unreachable("expected pinned backend to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(BackendUnavailableError);
      expect((error as BackendUnavailableError).alternatives.length).toBeGreaterThan(0);
    }
  });
});

describe("routing context cache", () => {
  afterEach(() => {
    resetRoutingContextCache();
    vi.restoreAllMocks();
  });

  it("reuses a warm demo snapshot instead of refetching", async () => {
    const snap = vi.spyOn(store, "getLatestSnapshot").mockResolvedValue(sampleSnapshot());
    const first = await loadRoutingContext(true);
    const second = await loadRoutingContext(true);
    expect(snap).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("coalesces concurrent demo loads onto one snapshot read", async () => {
    let finish!: (value: ReturnType<typeof sampleSnapshot>) => void;
    const snap = vi.spyOn(store, "getLatestSnapshot").mockImplementation(
      () => new Promise((resolve) => { finish = resolve; }),
    );
    const pending = Promise.all([loadRoutingContext(true), loadRoutingContext(true)]);
    expect(snap).toHaveBeenCalledTimes(1);
    finish(sampleSnapshot());
    const [left, right] = await pending;
    expect(left).toBe(right);
  });

  it("keeps demo, live, and public catalogs on separate cache keys", async () => {
    vi.spyOn(store, "getLatestSnapshot").mockResolvedValue(sampleSnapshot());
    vi.spyOn(healthMod, "loadPersistedBackendHealth").mockResolvedValue([]);
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: 9, ts: "2026-09-01T00:00:00Z", source: "live", price: 1100, vwap: 15, components: [] },
    });
    vi.spyOn(admin, "createAdminClient").mockReturnValue({
      from: (table: string) => {
        if (table === "qci_snapshots") {
          return { select: () => ({ order: () => ({ limit: () => ({ maybeSingle }) }) }) };
        }
        return { select: async () => ({ data: [], error: null }) };
      },
    } as never);

    const demo = await loadRoutingContext(true);
    const live = await loadRoutingContext(false);
    const pub = await loadPublicRoutingContext();
    expect(demo.snapshot.id).toBeNull();
    expect(live.snapshot.id).toBe(9);
    expect(pub.snapshot.id).toBeNull();
    expect(maybeSingle).toHaveBeenCalledTimes(1);

    await loadRoutingContext(false);
    expect(maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("loads the public snapshot and health in parallel on a cache miss", async () => {
    let releaseSnapshot!: () => void;
    let releaseHealth!: () => void;
    let snapshotStarted!: () => void;
    let healthStarted!: () => void;
    const snapshotReady = new Promise<void>((resolve) => { snapshotStarted = resolve; });
    const healthReady = new Promise<void>((resolve) => { healthStarted = resolve; });
    vi.spyOn(store, "getLatestSnapshot").mockImplementation(async () => {
      snapshotStarted();
      await new Promise<void>((resolve) => { releaseSnapshot = resolve; });
      return sampleSnapshot();
    });
    vi.spyOn(healthMod, "loadPersistedBackendHealth").mockImplementation(async () => {
      healthStarted();
      await new Promise<void>((resolve) => { releaseHealth = resolve; });
      return [];
    });

    const pending = loadPublicRoutingContext();
    await Promise.all([snapshotReady, healthReady]);
    releaseSnapshot();
    releaseHealth();
    await expect(pending).resolves.toMatchObject({ snapshot: { source: "sample" } });
  });
});

describe("provider target topology cache", () => {
  afterEach(() => {
    resetProviderTargetCache();
    vi.restoreAllMocks();
  });

  it("does not call Braket for IBM or all-to-all backends", async () => {
    const send = vi.spyOn(BraketClient.prototype, "send");
    await expect(resolveProviderTarget(getBackend("ibm-brisbane")!)).resolves.toMatchObject({ id: "ibm-brisbane", connectivity: "target" });
    await expect(resolveProviderTarget(getBackend("qci-aer-gpu")!)).resolves.toMatchObject({ connectivity: "all-to-all" });
    expect(send).not.toHaveBeenCalled();
  });

  it("caches a Braket coupling map and reapplies it onto a fresher backend row", async () => {
    const send = vi.spyOn(BraketClient.prototype, "send").mockResolvedValue({
      deviceCapabilities: JSON.stringify({
        paradigm: { connectivity: { fullyConnected: false, connectivityGraph: { "0": ["1"], "1": ["0", "2"] } } },
      }),
    } as never);
    const first = await resolveProviderTarget({ ...getBackend("iqm-garnet")!, queueSeconds: 10 });
    const second = await resolveProviderTarget({ ...getBackend("iqm-garnet")!, queueSeconds: 99, pricePerShot: 0.5 });
    expect(send).toHaveBeenCalledOnce();
    expect(first.connectivity).toBe("custom");
    expect(first.couplingMap).toEqual(expect.arrayContaining([[0, 1], [1, 2]]));
    expect(second.couplingMap).toEqual(first.couplingMap);
    expect(second.queueSeconds).toBe(99);
    expect(second.pricePerShot).toBe(0.5);
  });

  it("coalesces concurrent Braket lookups and briefly remembers failures", async () => {
    let finish!: (value: { deviceCapabilities: string }) => void;
    const send = vi.spyOn(BraketClient.prototype, "send").mockImplementation(
      () => new Promise((resolve) => { finish = resolve; }) as never,
    );
    const pending = Promise.all([
      resolveProviderTarget(getBackend("rigetti-ankaa-3")!),
      resolveProviderTarget(getBackend("rigetti-ankaa-3")!),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    finish({ deviceCapabilities: JSON.stringify({ paradigm: { connectivity: { fullyConnected: true } } }) });
    const [left, right] = await pending;
    expect(left.connectivity).toBe("all-to-all");
    expect(right.connectivity).toBe("all-to-all");

    send.mockRejectedValueOnce(new Error("timeout"));
    resetProviderTargetCache();
    await expect(resolveProviderTarget(getBackend("iqm-garnet")!)).rejects.toThrow("timeout");
    await expect(resolveProviderTarget(getBackend("iqm-garnet")!)).rejects.toThrow("timeout");
    expect(send).toHaveBeenCalledTimes(2);
    resetProviderTargetCache();
    send.mockResolvedValueOnce({
      deviceCapabilities: JSON.stringify({ paradigm: { connectivity: { fullyConnected: true } } }),
    } as never);
    await expect(resolveProviderTarget(getBackend("iqm-garnet")!)).resolves.toMatchObject({ connectivity: "all-to-all" });
    expect(send).toHaveBeenCalledTimes(3);
  });
});

describe("catalog and health indexes", () => {
  it("resolves every catalog id in O(1)", () => {
    for (const backend of BACKENDS) {
      expect(getBackend(backend.id)).toBe(backend);
    }
    expect(getBackend("missing")).toBeUndefined();
  });

  it("returns the static catalog when the snapshot has no components", () => {
    expect(withQciSnapshot([])).toBe(BACKENDS);
  });

  it("overlays QCI queue and price without changing qubit counts", () => {
    const backends = withQciSnapshot([{
      provider: "IonQ", qpu: "Aria", capacity: 999, clops: 50, queueSeconds: 3, fid2q: 0.91, pricePerNqh: 8, status: "live",
    } as never]);
    expect(backends.find((item) => item.id === "ionq-aria-1")).toMatchObject({ qubits: 25, queueSeconds: 3, clops: 50, pricePerNqh: 8 });
  });

  it("indexes health by backend id and leaves an empty overlay untouched", () => {
    expect(applyProviderHealth(BACKENDS, [])).toBe(BACKENDS);
    const checkedAt = new Date().toISOString();
    const applied = applyProviderHealth(BACKENDS, [
      { backend_id: "qci-aer-gpu", configured: true, reachable: false, consecutive_failures: 2, detail: "down", checked_at: checkedAt },
      { backend_id: "qci-aer-gpu", configured: true, reachable: true, consecutive_failures: 0, detail: "later row ignored", checked_at: checkedAt },
    ]);
    expect(applied[0]).toMatchObject({ available: false, status: "offline", health: { detail: "down" } });
  });
});

describe("QCI routing lens policies", () => {
  it("ranks the same basket differently under each published policy", () => {
    const devices = [
      device("cheap-slow", { pricePerHour: 1, queueSeconds: 20_000, capability: 0.2 }),
      device("fast-pricey", { pricePerHour: 8_000, queueSeconds: 1, capability: 0.25 }),
      device("high-fid", { pricePerHour: 7_000, queueSeconds: 12_000, capability: 8 }),
    ];
    const byPolicy = Object.fromEntries(POLICIES.map((policy) => [policy.id, rankDevices(devices, policy).winner?.device.id]));
    expect(byPolicy.cost).toBe("cheap-slow");
    expect(byPolicy.speed).toBe("fast-pricey");
    expect(byPolicy.quality).toBe("high-fid");
    expect(byPolicy.balanced).toBeTruthy();
  });

  it("drops unpriced devices and redistributes a missing queue axis", () => {
    const ranking = rankDevices([
      device("priced", { pricePerHour: 50, queueSeconds: undefined }),
      device("free", { pricePerHour: 0 }),
    ], POLICIES[0]);
    expect(ranking.ranked.map((item) => item.device.id)).toEqual(["priced"]);
    expect(ranking.missingAxes).toContain("queue");
    expect(ranking.effectiveWeights.queue).toBe(0);
  });
});

describe("loadPersistedBackendHealth stays best-effort", () => {
  it("returns an empty list when the admin client is unavailable", async () => {
    vi.spyOn(admin, "createAdminClient").mockImplementation(() => {
      throw new Error("not configured");
    });
    await expect(loadPersistedBackendHealth()).resolves.toEqual([]);
    vi.restoreAllMocks();
  });
});
