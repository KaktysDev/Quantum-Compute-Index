import type { RawQpuMetrics } from "@/lib/qci/types";
import type { ProviderAdapter } from "./types";
import { withDailyDrift } from "./util";

// Photonic hardware (Borealis / X-series) via Xanadu Cloud.
const XANADU_QPUS: RawQpuMetrics[] = [
  {
    provider: "Xanadu",
    qpu: "Borealis",
    rawPrice: 0.0012,
    unit: "per_shot",
    qv: 96, // representative effective QV for photonic GBS hardware
    clops: 900,
    fid2q: 0.978,
    capacity: 216,
  },
];

export const xanadu: ProviderAdapter = {
  id: "xanadu",
  name: "Xanadu",
  description: "Photonic quantum computing via Xanadu Cloud.",
  docsUrl: "https://cloud.xanadu.ai/",
  keyPlaceholder: "Xanadu Cloud API key",
  covers: ["Xanadu Borealis"],

  async fetchMetrics(apiKey: string, date = new Date()): Promise<RawQpuMetrics[]> {
    if (!apiKey) return [];
    // TODO: call Xanadu Cloud APIs for live device + pricing data.
    return XANADU_QPUS.map((q) => withDailyDrift(q, date));
  },
};
