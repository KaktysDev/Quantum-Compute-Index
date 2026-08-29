import { BraketClient, GetDeviceCommand } from "@aws-sdk/client-braket";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Backend } from "./types";

export interface ProviderHealth {
  provider: string;
  configured: boolean;
  reachable: boolean;
  detail: string;
  checkedAt: string;
  backendIds: string[];
}

export interface PersistedBackendHealth {
  backend_id: string;
  configured: boolean;
  reachable: boolean;
  consecutive_failures: number;
  detail: string;
  checked_at: string;
}

async function probe(name: string, backendIds: string[], configured: boolean, operation: () => Promise<string>): Promise<ProviderHealth> {
  const checkedAt = new Date().toISOString();
  if (!configured) return { provider: name, backendIds, configured: false, reachable: false, detail: "Credentials are not configured.", checkedAt };
  try { return { provider: name, backendIds, configured: true, reachable: true, detail: await operation(), checkedAt }; }
  catch (error) { return { provider: name, backendIds, configured: true, reachable: false, detail: error instanceof Error ? error.message : "Health check failed.", checkedAt }; }
}

export async function checkProviderConnections() {
  const compilerUrl = process.env.QROUTER_COMPILER_URL ?? process.env.VULTR_SIMULATOR_URL;
  const compilerToken = process.env.QROUTER_COMPILER_TOKEN ?? process.env.VULTR_SIMULATOR_TOKEN;
  return Promise.all([
    // qci-aer-gpu stays runnable with no remote compiler: submitVultr and
    // transpileForBackend both fall back to in-process simulation. Reporting it
    // unreachable here would open the health circuit breaker and strand the one
    // backend that always works, so an absent worker is healthy-but-degraded
    // rather than a failure.
    probe("Qiskit compiler", ["qci-aer-gpu"], true, async () => {
      if (!compilerUrl || !compilerToken) {
        return "No remote worker configured; running the in-process state-vector simulator (30 qubits max).";
      }
      const response = await fetch(`${compilerUrl.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`Compiler health returned ${response.status}.`);
      const data = await response.json() as { device?: string; backend?: string };
      return `${data.backend ?? "Qiskit"} on ${data.device ?? "unknown device"}`;
    }),
    probe("IBM Quantum", ["ibm-brisbane"], Boolean(process.env.IBM_QUANTUM_TOKEN), async () => {
      const response = await fetch("https://api.quantum-computing.ibm.com/runtime/backends", {
        headers: { authorization: `Bearer ${process.env.IBM_QUANTUM_TOKEN}` }, signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`IBM Runtime returned ${response.status}.`);
      return "IBM Runtime API reachable.";
    }),
    probe("Amazon Braket", process.env.IONQ_API_KEY ? ["aws-sv1", "iqm-garnet"] : ["aws-sv1", "iqm-garnet", "ionq-aria-1"], Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.BRAKET_OUTPUT_BUCKET), async () => {
      const device = await new BraketClient({ region: "us-east-1" }).send(new GetDeviceCommand({
        deviceArn: "arn:aws:braket:::device/quantum-simulator/amazon/sv1",
      }));
      return `SV1 status: ${device.deviceStatus ?? "unknown"}.`;
    }),
    probe("IonQ", process.env.IONQ_API_KEY ? ["ionq-aria-1"] : [], Boolean(process.env.IONQ_API_KEY), async () => {
      const backend = process.env.IONQ_BACKEND ?? "qpu.aria-1";
      const response = await fetch(`https://api.ionq.co/v0.4/backends/${encodeURIComponent(backend)}`, {
        headers: { authorization: `apiKey ${process.env.IONQ_API_KEY}` }, signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`IonQ returned ${response.status}.`);
      return `${backend} reachable.`;
    }),
    probe("Quandela bridge", ["quandela-mosaiq"], Boolean(process.env.QUANDELA_EXECUTION_URL && process.env.QUANDELA_API_KEY), async () => {
      const response = await fetch(`${process.env.QUANDELA_EXECUTION_URL!.replace(/\/$/, "")}/health`, {
        headers: { authorization: `Bearer ${process.env.QUANDELA_API_KEY}` }, signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Quandela bridge returned ${response.status}.`);
      return "Execution bridge reachable.";
    }),
    probe("Xanadu bridge", ["xanadu-borealis"], Boolean(process.env.XANADU_EXECUTION_URL && process.env.XANADU_API_KEY), async () => {
      const response = await fetch(`${process.env.XANADU_EXECUTION_URL!.replace(/\/$/, "")}/health`, {
        headers: { authorization: `Bearer ${process.env.XANADU_API_KEY}` }, signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Xanadu bridge returned ${response.status}.`);
      return "Execution bridge reachable.";
    }),
    probe("Quantum Inspire", ["qi-starmon-5"], Boolean(process.env.QI_API_KEY), async () => {
      if (process.env.QI_EXECUTION_URL) {
        const response = await fetch(`${process.env.QI_EXECUTION_URL.replace(/\/$/, "")}/health`, {
          headers: { authorization: `Bearer ${process.env.QI_API_KEY}` }, signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`Quantum Inspire bridge returned ${response.status}.`);
        return "Execution bridge reachable.";
      }
      const base = (process.env.QI_API_BASE ?? "https://api.quantum-inspire.com").replace(/\/$/, "");
      const response = await fetch(`${base}/backendtypes/`, {
        headers: { authorization: `Token ${process.env.QI_API_KEY}` }, signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Quantum Inspire returned ${response.status}.`);
      return "Quantum Inspire API reachable.";
    }),
  ]);
}

export function applyProviderHealth(backends: Backend[], health: PersistedBackendHealth[], now = new Date()) {
  return backends.map((backend) => {
    const latest = health.find((item) => item.backend_id === backend.id);
    if (!latest) return backend;
    const ageMs = now.getTime() - new Date(latest.checked_at).getTime();
    const stale = !Number.isFinite(ageMs) || ageMs > 10 * 60_000;
    const circuitOpen = !latest.reachable && latest.consecutive_failures >= 2;
    return {
      ...backend,
      available: circuitOpen ? false : backend.available,
      status: circuitOpen ? "offline" as const : stale || !latest.reachable ? "degraded" as const : backend.status,
      health: {
        reachable: latest.reachable,
        consecutiveFailures: latest.consecutive_failures,
        detail: stale ? `Health telemetry is stale. ${latest.detail}` : latest.detail,
        checkedAt: latest.checked_at,
      },
    };
  });
}

export async function loadPersistedBackendHealth() {
  try {
    const { data, error } = await createAdminClient().from("provider_health").select("backend_id,configured,reachable,consecutive_failures,detail,checked_at");
    if (error) throw error;
    return (data ?? []) as PersistedBackendHealth[];
  } catch {
    return [];
  }
}
