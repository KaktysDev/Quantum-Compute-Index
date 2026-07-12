import { BraketClient, GetDeviceCommand } from "@aws-sdk/client-braket";

export interface ProviderHealth {
  provider: string;
  configured: boolean;
  reachable: boolean;
  detail: string;
  checkedAt: string;
}

async function probe(name: string, configured: boolean, operation: () => Promise<string>): Promise<ProviderHealth> {
  const checkedAt = new Date().toISOString();
  if (!configured) return { provider: name, configured: false, reachable: false, detail: "Credentials are not configured.", checkedAt };
  try { return { provider: name, configured: true, reachable: true, detail: await operation(), checkedAt }; }
  catch (error) { return { provider: name, configured: true, reachable: false, detail: error instanceof Error ? error.message : "Health check failed.", checkedAt }; }
}

export async function checkProviderConnections() {
  const compilerUrl = process.env.QROUTER_COMPILER_URL ?? process.env.VULTR_SIMULATOR_URL;
  const compilerToken = process.env.QROUTER_COMPILER_TOKEN ?? process.env.VULTR_SIMULATOR_TOKEN;
  return Promise.all([
    probe("Qiskit compiler", Boolean(compilerUrl && compilerToken), async () => {
      const response = await fetch(`${compilerUrl!.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`Compiler health returned ${response.status}.`);
      const data = await response.json() as { device?: string; backend?: string };
      return `${data.backend ?? "Qiskit"} on ${data.device ?? "unknown device"}`;
    }),
    probe("IBM Quantum", Boolean(process.env.IBM_QUANTUM_TOKEN), async () => {
      const response = await fetch("https://api.quantum-computing.ibm.com/runtime/backends", {
        headers: { authorization: `Bearer ${process.env.IBM_QUANTUM_TOKEN}` }, signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`IBM Runtime returned ${response.status}.`);
      return "IBM Runtime API reachable.";
    }),
    probe("Amazon Braket", Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.BRAKET_OUTPUT_BUCKET), async () => {
      const device = await new BraketClient({ region: "us-east-1" }).send(new GetDeviceCommand({
        deviceArn: "arn:aws:braket:::device/quantum-simulator/amazon/sv1",
      }));
      return `SV1 status: ${device.deviceStatus ?? "unknown"}.`;
    }),
    probe("IonQ", Boolean(process.env.IONQ_API_KEY), async () => {
      const backend = process.env.IONQ_BACKEND ?? "qpu.aria-1";
      const response = await fetch(`https://api.ionq.co/v0.4/backends/${encodeURIComponent(backend)}`, {
        headers: { authorization: `apiKey ${process.env.IONQ_API_KEY}` }, signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`IonQ returned ${response.status}.`);
      return `${backend} reachable.`;
    }),
    ...[
      ["Quandela bridge", process.env.QUANDELA_EXECUTION_URL, process.env.QUANDELA_API_KEY],
      ["Xanadu bridge", process.env.XANADU_EXECUTION_URL, process.env.XANADU_API_KEY],
      ["Quantum Inspire bridge", process.env.QI_EXECUTION_URL, process.env.QI_API_KEY],
    ].map(([name, url, token]) => probe(name!, Boolean(url && token), async () => {
      const response = await fetch(`${url!.replace(/\/$/, "")}/health`, {
        headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`${name} returned ${response.status}.`);
      return "Execution bridge reachable.";
    })),
  ]);
}
