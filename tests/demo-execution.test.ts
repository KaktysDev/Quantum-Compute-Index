import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeCircuit } from "@/lib/qrouter/analyze";
import type { Principal } from "@/lib/qrouter/auth";
import { BACKENDS } from "@/lib/qrouter/catalog";
import { submitToProvider } from "@/lib/qrouter/execution";
import { assertTargetAllowedV2, backendsForPrincipal } from "@/lib/qrouter/scopes";

const source = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[1];\ncreg c[1];\nx q[0];\nmeasure q -> c;';
const otherSource = source.replace("x q[0];", "id q[0];");
const demo: Principal = { organizationId: "demo", userId: null, apiKeyId: null, demo: true, environment: null };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("explicit inline development execution", () => {
  it("completes the exact quoted circuit without contacting a configured worker", async () => {
    vi.stubEnv("VULTR_SIMULATOR_URL", "https://worker.invalid");
    vi.stubEnv("IONQ_API_KEY", "configured-on-host");
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const result = await submitToProvider("qci-aer-gpu", analyzeCircuit(otherSource, "openqasm2"), 32, "demo-job",
      { media_type: "text/qasm2", payload: source }, { localDemo: true });
    expect(result.status).toBe("completed");
    expect(result.result?.counts).toEqual({ "1": 32 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses external targets even when provider credentials exist", async () => {
    vi.stubEnv("IONQ_API_KEY", "configured-on-host");
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(submitToProvider("ionq-aria-1", analyzeCircuit(source, "openqasm2"), 32, "demo-job",
      { media_type: "text/qasm2", payload: source }, { localDemo: true })).rejects.toThrow(/cannot submit to an external/);
    expect(fetcher).not.toHaveBeenCalled();
    expect(backendsForPrincipal(demo, BACKENDS).map((backend) => backend.id)).toEqual(["qci-aer-gpu"]);
    expect(() => assertTargetAllowedV2(demo, "aws-sv1", BACKENDS)).toThrow(/inline QCI simulator/);
    expect(() => assertTargetAllowedV2(demo, "ibm-brisbane", BACKENDS)).toThrow(/inline QCI simulator/);
  });

  it("keeps authenticated live and test principals on their existing boundaries", () => {
    const live = { ...demo, demo: false, environment: "live" as const };
    const test = { ...live, environment: "test" as const };
    expect(backendsForPrincipal(live, BACKENDS)).toEqual(BACKENDS);
    expect(backendsForPrincipal(test, BACKENDS)).toEqual(BACKENDS.filter((backend) => backend.kind === "simulator"));
    expect(() => assertTargetAllowedV2(live, "ibm-brisbane", BACKENDS)).not.toThrow();
  });
});
