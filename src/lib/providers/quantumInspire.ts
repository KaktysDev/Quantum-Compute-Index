import type { RawQpuMetrics } from "@/lib/qci/types";
import type { ProviderAdapter } from "./types";
import { withDailyDrift } from "./util";

// Quantum Inspire / TNO — open-access (free). We attribute a small nominal
// academic rate and low capacity weight so a free provider does not crater the
// price index while still contributing to its performance profile.
const QI_QPUS: RawQpuMetrics[] = [
  {
    provider: "Quantum Inspire",
    qpu: "Starmon-5",
    rawPrice: 0.0003,
    unit: "per_shot",
    qv: 16,
    clops: 400,
    fid2q: 0.965,
    capacity: 5,
  },
  {
    provider: "Quantum Inspire",
    qpu: "Spin-2",
    rawPrice: 0.0003,
    unit: "per_shot",
    qv: 4,
    clops: 300,
    fid2q: 0.96,
    capacity: 2,
  },
];

export const quantumInspire: ProviderAdapter = {
  id: "quantum-inspire",
  name: "Quantum Inspire / TNO",
  description: "Open-access (free) hardware — Starmon-5 & Spin-2.",
  docsUrl: "https://www.quantum-inspire.com/",
  keyPlaceholder: "Quantum Inspire API token",
  covers: ["Quantum Inspire Starmon-5", "Quantum Inspire Spin-2"],

  async fetchMetrics(apiKey: string, date = new Date()): Promise<RawQpuMetrics[]> {
    if (!apiKey) return [];
    // TODO: call Quantum Inspire APIs for live backend status data.
    return QI_QPUS.map((q) => withDailyDrift(q, date));
  },
};
