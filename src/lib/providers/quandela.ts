import type { RawQpuMetrics } from "@/lib/qci/types";
import type { ProviderAdapter } from "./types";
import { withDailyDrift } from "./util";

// Photonic hardware (Ascella) via Quandela Cloud.
const QUANDELA_QPUS: RawQpuMetrics[] = [
  {
    provider: "Quandela",
    qpu: "Ascella",
    rawPrice: 0.0014,
    unit: "per_shot",
    qv: 80,
    clops: 700,
    fid2q: 0.974,
    capacity: 12,
  },
];

export const quandela: ProviderAdapter = {
  id: "quandela",
  name: "Quandela",
  description: "Photonic quantum computing via Quandela Cloud.",
  docsUrl: "https://cloud.quandela.com/",
  keyPlaceholder: "Quandela Cloud API key",
  covers: ["Quandela Ascella"],

  async fetchMetrics(apiKey: string, date = new Date()): Promise<RawQpuMetrics[]> {
    if (!apiKey) return [];
    // TODO: call Quandela Cloud APIs for live device + pricing data.
    return QUANDELA_QPUS.map((q) => withDailyDrift(q, date));
  },
};
