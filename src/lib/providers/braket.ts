import { SEED_QPUS } from "@/lib/qci/seed";
import type { RawQpuMetrics } from "@/lib/qci/types";
import type { ProviderAdapter } from "./types";
import { withDailyDrift } from "./util";

// AWS Braket exposes multiple hardware vendors under one account.
const BRAKET_QPUS = SEED_QPUS.filter((q) =>
  ["IonQ", "Rigetti", "IQM"].includes(q.provider),
);

export const braket: ProviderAdapter = {
  id: "braket",
  name: "AWS Braket",
  description: "One key covers IonQ, Rigetti, QuEra & IQM hardware.",
  docsUrl: "https://aws.amazon.com/braket/",
  keyPlaceholder: "AWS access key (or Braket credentials JSON)",
  covers: ["IonQ Forte", "Rigetti Ankaa", "IQM Emerald"],

  async fetchMetrics(apiKey: string, date = new Date()): Promise<RawQpuMetrics[]> {
    if (!apiKey) return [];
    // TODO: use AWS Braket APIs (GetDevice, pricing) for live metrics per device.
    return BRAKET_QPUS.map((q) => withDailyDrift(q, date));
  },
};
