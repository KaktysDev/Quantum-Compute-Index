import { describe, expect, it } from "vitest";
import { buildRunRequest, DEFAULT_RUN_SETTINGS, estimateProviderCost, executionKeys } from "@/lib/client/compare";
import { createExecutionGroupSchema } from "@/lib/qrouter/v2";

const CIRCUIT = "0b8f5d8e-6f0c-4d5a-9a44-1f1a2b3c4d5e";

describe("compare-run request builder", () => {
  it("derives unique, readable execution keys", () => {
    expect(executionKeys(["ibm-brisbane", "auto", "auto", "IonQ Aria 1"])).toEqual(["ibm-brisbane", "auto", "auto-2", "ionq-aria-1"]);
    expect(executionKeys(["***"])).toEqual(["target"]);
  });

  it("produces bodies the v2 job schema accepts", () => {
    const body = buildRunRequest({ circuitId: CIRCUIT, name: "  Bell sweep  ", targets: ["qci-aer-gpu", "auto", "aws-sv1"], settings: DEFAULT_RUN_SETTINGS });
    const parsed = createExecutionGroupSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(body.metadata).toEqual({ name: "Bell sweep" });
    expect(body.executions.map((execution) => execution.key)).toEqual(["qci-aer-gpu", "auto", "aws-sv1"]);
  });

  it("omits the name when blank", () => {
    const body = buildRunRequest({ circuitId: CIRCUIT, name: "   ", targets: ["auto"], settings: { ...DEFAULT_RUN_SETTINGS, shots: 10 } });
    expect(body.metadata).toEqual({});
    expect(createExecutionGroupSchema.safeParse(body).success).toBe(true);
  });

  it("estimates provider cost from list prices", () => {
    expect(estimateProviderCost({ pricePerShot: 0.001, pricePerTask: 0.3 }, 1000)).toBeCloseTo(1.3);
    expect(estimateProviderCost({}, 1000)).toBeNull();
  });
});
