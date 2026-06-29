import { SEED_QPUS } from "@/lib/qci/seed";
import type { RawQpuMetrics } from "@/lib/qci/types";
import type { ProviderAdapter } from "./types";
import { withDailyDrift } from "./util";

const IBM_QPUS = SEED_QPUS.filter((q) => q.provider === "IBM");

export const ibm: ProviderAdapter = {
  id: "ibm",
  name: "IBM Quantum",
  description: "Eagle/Osprey superconducting QPUs via IBM Quantum Platform.",
  docsUrl: "https://quantum.ibm.com/",
  keyPlaceholder: "IBM Quantum API token",
  covers: ["IBM Eagle/Osprey"],

  async fetchMetrics(apiKey: string, date = new Date()): Promise<RawQpuMetrics[]> {
    if (!apiKey) return [];
    // TODO: call IBM Quantum APIs for live pricing / calibration / queue data.
    return IBM_QPUS.map((q) => withDailyDrift(q, date));
  },
};
