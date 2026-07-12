import { BraketClient, CancelQuantumTaskCommand, CreateQuantumTaskCommand, GetQuantumTaskCommand } from "@aws-sdk/client-braket";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { simulateCircuit } from "./simulator";
import type { CircuitAnalysis } from "./types";

export interface Submission { providerJobId: string; status: "submitted" | "completed"; result?: Record<string, unknown> }
export interface ProviderStatus { status: "submitted" | "processing" | "completed" | "failed" | "cancelled"; result?: Record<string, unknown>; error?: string; actualProviderCost?: number }

const BRAKET_DEVICES: Record<string, { arn: string; region: string }> = {
  "aws-sv1": { arn: "arn:aws:braket:::device/quantum-simulator/amazon/sv1", region: "us-east-1" },
  "iqm-garnet": { arn: "arn:aws:braket:eu-north-1::device/qpu/iqm/Garnet", region: "eu-north-1" },
};

export function qasm2ToQasm3(source: string) {
  return source
    .replace(/OPENQASM\s+2\.0\s*;/i, "OPENQASM 3.0;")
    .replace(/include\s+"qelib1\.inc"\s*;/i, 'include "stdgates.inc";')
    .replace(/\bqreg\s+(\w+)\[(\d+)]\s*;/g, "qubit[$2] $1;")
    .replace(/\bcreg\s+(\w+)\[(\d+)]\s*;/g, "bit[$2] $1;")
    .replace(/\bcx\b/g, "cnot")
    .replace(/measure\s+(\w+)\s*->\s*(\w+)\s*;/g, "$2 = measure $1;")
    .replace(/measure\s+(\w+)\[(\d+)]\s*->\s*(\w+)\[(\d+)]\s*;/g, "$3[$4] = measure $1[$2];");
}

async function submitVultr(analysis: CircuitAnalysis, shots: number): Promise<Submission> {
  const endpoint = process.env.VULTR_SIMULATOR_URL;
  if (!endpoint) {
    return { providerJobId: `local_${crypto.randomUUID()}`, status: "completed", result: simulateCircuit(analysis, shots) as unknown as Record<string, unknown> };
  }
  const response = await fetch(`${endpoint.replace(/\/$/, "")}/v1/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.VULTR_SIMULATOR_TOKEN ?? ""}` },
    body: JSON.stringify({ qasm: analysis.normalizedQasm2, shots }),
  });
  if (!response.ok) throw new Error(`Vultr simulator rejected the job (${response.status}).`);
  const data = await response.json() as { id: string; result?: Record<string, unknown> };
  return { providerJobId: data.id, status: data.result ? "completed" : "submitted", result: data.result };
}

async function submitBraket(backendId: string, analysis: CircuitAnalysis, shots: number, clientToken: string): Promise<Submission> {
  const device = BRAKET_DEVICES[backendId];
  const bucket = process.env.BRAKET_OUTPUT_BUCKET;
  if (!device || !bucket) throw new Error("Amazon Braket is not configured.");
  const client = new BraketClient({ region: device.region });
  const action = JSON.stringify({ braketSchemaHeader: { name: "braket.ir.openqasm.program", version: "1" }, source: qasm2ToQasm3(analysis.normalizedQasm2) });
  const response = await client.send(new CreateQuantumTaskCommand({
    action, clientToken: clientToken.slice(0, 64), deviceArn: device.arn,
    outputS3Bucket: bucket, outputS3KeyPrefix: `qrouter/${clientToken}`, shots,
    tags: { product: "qrouter", job: clientToken },
  }));
  if (!response.quantumTaskArn) throw new Error("Amazon Braket did not return a task ARN.");
  return { providerJobId: response.quantumTaskArn, status: "submitted" };
}

async function submitIbm(analysis: CircuitAnalysis, shots: number): Promise<Submission> {
  const token = process.env.IBM_QUANTUM_TOKEN;
  if (!token) throw new Error("IBM Quantum is not configured.");
  const [hub, group, project] = (process.env.IBM_QUANTUM_INSTANCE ?? "ibm-q/open/main").split("/");
  const response = await fetch("https://api.quantum-computing.ibm.com/runtime/jobs", {
    method: "POST",
    headers: { accept: "application/json", authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      program_id: "sampler", backend: process.env.IBM_QUANTUM_BACKEND ?? "ibm_brisbane", hub, group, project,
      params: { pubs: [[qasm2ToQasm3(analysis.normalizedQasm2)]], options: { default_shots: shots }, version: 2 },
    }),
  });
  if (!response.ok) throw new Error(`IBM Quantum rejected the job (${response.status}): ${await response.text()}`);
  const data = await response.json() as { id?: string };
  if (!data.id) throw new Error("IBM Quantum did not return a job ID.");
  return { providerJobId: data.id, status: "submitted" };
}

function ionqHeaders() {
  const token = process.env.IONQ_API_KEY;
  if (!token) throw new Error("IonQ is not configured.");
  return { "content-type": "application/json", authorization: `apiKey ${token}` };
}

function qasm2ToIonqCircuit(source: string) {
  const gates: Array<Record<string, unknown>> = [];
  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim().replace(/;$/, "");
    let match = /^(h|x|y|z|s|t)\s+q\[(\d+)]$/i.exec(line);
    if (match) {
      gates.push({ gate: match[1].toLowerCase(), target: Number(match[2]) });
      continue;
    }
    match = /^(rx|ry|rz)\(([^)]+)\)\s+q\[(\d+)]$/i.exec(line);
    if (match) {
      gates.push({ gate: match[1].toLowerCase(), rotation: match[2], target: Number(match[3]) });
      continue;
    }
    match = /^(cx|cnot)\s+q\[(\d+)],\s*q\[(\d+)]$/i.exec(line);
    if (match) gates.push({ gate: "cnot", control: Number(match[2]), target: Number(match[3]) });
  }
  return gates;
}

async function submitIonq(analysis: CircuitAnalysis, shots: number, jobId: string): Promise<Submission> {
  const response = await fetch("https://api.ionq.co/v0.4/jobs", {
    method: "POST",
    headers: ionqHeaders(),
    body: JSON.stringify({
      name: jobId,
      type: "ionq.circuit.v1",
      shots,
      metadata: { qrouter_qubits: String(analysis.qubits), qrouter_job_id: jobId },
      input: {
        qubits: analysis.qubits,
        gateset: "qis",
        circuit: qasm2ToIonqCircuit(analysis.normalizedQasm2),
      },
    }),
  });
  if (!response.ok) throw new Error(`IonQ rejected the job (${response.status}): ${await response.text()}`);
  const data = await response.json() as { id?: string };
  if (!data.id) throw new Error("IonQ did not return a job ID.");
  return { providerJobId: data.id, status: "submitted" };
}

export async function submitToProvider(backendId: string, analysis: CircuitAnalysis, shots: number, jobId: string): Promise<Submission> {
  if (backendId === "qci-aer-gpu") return submitVultr(analysis, shots);
  if (backendId === "ibm-brisbane") return submitIbm(analysis, shots);
  if (backendId === "ionq-aria-1") return submitIonq(analysis, shots, jobId);
  if (BRAKET_DEVICES[backendId]) return submitBraket(backendId, analysis, shots, jobId);
  throw new Error(`Execution adapter for ${backendId} is not enabled.`);
}

async function readStream(body: NonNullable<Awaited<ReturnType<S3Client["send"]>> extends never ? never : unknown>) {
  const stream = body as { transformToString?: () => Promise<string> };
  if (!stream.transformToString) throw new Error("Unable to read Braket result body.");
  return stream.transformToString();
}

function normalizeIonqProbabilities(probabilities: Record<string, number>, qubits: number) {
  return Object.fromEntries(
    Object.entries(probabilities).map(([state, probability]) => {
      const bitstring = /^\d+$/.test(state) ? Number(state).toString(2).padStart(qubits, "0") : state.padStart(qubits, "0");
      return [bitstring, probability];
    }),
  );
}

async function getIonqStatus(providerJobId: string): Promise<ProviderStatus> {
  const response = await fetch(`https://api.ionq.co/v0.4/jobs/${encodeURIComponent(providerJobId)}`, { headers: ionqHeaders() });
  if (!response.ok) throw new Error(`IonQ status request failed (${response.status}).`);
  const data = await response.json() as {
    status?: string;
    failure?: { error?: string };
    error?: string;
    shots?: number;
    metadata?: { qrouter_qubits?: string };
    results?: { probabilities?: { url?: string } | Record<string, number> };
  };
  const raw = (data.status ?? "submitted").toLowerCase();
  if (["completed", "succeeded"].includes(raw)) {
    const qubits = Number(data.metadata?.qrouter_qubits ?? 0);
    const probabilitySource = data.results?.probabilities;
    let probabilities: Record<string, number> = {};
    if (probabilitySource && "url" in probabilitySource && typeof probabilitySource.url === "string") {
      const resultResponse = await fetch(probabilitySource.url, { headers: ionqHeaders() });
      if (!resultResponse.ok) throw new Error(`IonQ result request failed (${resultResponse.status}).`);
      probabilities = await resultResponse.json() as Record<string, number>;
    } else if (probabilitySource) {
      probabilities = probabilitySource as Record<string, number>;
    }
    const normalized = normalizeIonqProbabilities(probabilities, qubits);
    const shots = data.shots ?? 0;
    const counts = Object.fromEntries(Object.entries(normalized).map(([state, probability]) => [state, Math.round(probability * shots)]));
    let actualProviderCost: number | undefined;
    const costResponse = await fetch(`https://api.ionq.co/v0.4/jobs/${encodeURIComponent(providerJobId)}/cost`, { headers: ionqHeaders() });
    if (costResponse.ok) {
      const cost = await costResponse.json() as { cost?: number };
      actualProviderCost = cost.cost;
    }
    return { status: "completed", actualProviderCost, result: { probabilities: normalized, counts, shots } };
  }
  if (["failed", "error"].includes(raw)) return { status: "failed", error: data.failure?.error ?? data.error ?? "IonQ job failed." };
  if (["canceled", "cancelled"].includes(raw)) return { status: "cancelled" };
  return { status: ["running", "processing"].includes(raw) ? "processing" : "submitted" };
}

export async function getProviderStatus(backendId: string, providerJobId: string): Promise<ProviderStatus> {
  if (backendId === "qci-aer-gpu" && process.env.VULTR_SIMULATOR_URL) {
    const response = await fetch(`${process.env.VULTR_SIMULATOR_URL.replace(/\/$/, "")}/v1/jobs/${encodeURIComponent(providerJobId)}`, { headers: { authorization: `Bearer ${process.env.VULTR_SIMULATOR_TOKEN ?? ""}` } });
    if (!response.ok) throw new Error(`Vultr status request failed (${response.status}).`);
    return response.json() as Promise<ProviderStatus>;
  }
  if (backendId === "ibm-brisbane") {
    const response = await fetch(`https://api.quantum-computing.ibm.com/runtime/jobs/${encodeURIComponent(providerJobId)}`, { headers: { accept: "application/json", authorization: `Bearer ${process.env.IBM_QUANTUM_TOKEN ?? ""}` } });
    if (!response.ok) throw new Error(`IBM status request failed (${response.status}).`);
    const data = await response.json() as { state?: { status?: string; reason?: string }; status?: string; results?: Record<string, unknown> };
    const raw = (data.state?.status ?? data.status ?? "queued").toLowerCase();
    if (["completed", "done"].includes(raw)) return { status: "completed", result: data.results ?? { providerJobId, message: "Results are available from IBM Runtime." } };
    if (["failed", "error"].includes(raw)) return { status: "failed", error: data.state?.reason ?? "IBM job failed." };
    if (["cancelled", "canceled"].includes(raw)) return { status: "cancelled" };
    return { status: ["running", "executing"].includes(raw) ? "processing" : "submitted" };
  }
  if (backendId === "ionq-aria-1") return getIonqStatus(providerJobId);
  const device = BRAKET_DEVICES[backendId];
  if (device) {
    const client = new BraketClient({ region: device.region });
    const task = await client.send(new GetQuantumTaskCommand({ quantumTaskArn: providerJobId }));
    const raw = task.status ?? "QUEUED";
    if (raw === "COMPLETED") {
      const bucket = task.outputS3Bucket ?? process.env.BRAKET_OUTPUT_BUCKET!;
      const key = `${task.outputS3Directory}/results.json`.replace(/^\//, "");
      const object = await new S3Client({ region: device.region }).send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!object.Body) throw new Error("Braket result object did not include a readable body.");
      const result = JSON.parse(await readStream(object.Body)) as Record<string, unknown>;
      return { status: "completed", result };
    }
    if (raw === "FAILED") return { status: "failed", error: task.failureReason ?? "Braket task failed." };
    if (raw === "CANCELLED") return { status: "cancelled" };
    return { status: raw === "RUNNING" ? "processing" : "submitted" };
  }
  throw new Error(`Status adapter for ${backendId} is not enabled.`);
}

export async function cancelProviderJob(backendId: string, providerJobId: string) {
  if (backendId === "qci-aer-gpu" && process.env.VULTR_SIMULATOR_URL) {
    const response = await fetch(`${process.env.VULTR_SIMULATOR_URL.replace(/\/$/, "")}/v1/jobs/${encodeURIComponent(providerJobId)}`, { method: "DELETE", headers: { authorization: `Bearer ${process.env.VULTR_SIMULATOR_TOKEN ?? ""}` } });
    if (!response.ok) throw new Error(`Vultr cancellation failed (${response.status}).`);
    return;
  }
  if (backendId === "ibm-brisbane") {
    const response = await fetch(`https://api.quantum-computing.ibm.com/runtime/jobs/${encodeURIComponent(providerJobId)}/cancel`, { method: "POST", headers: { authorization: `Bearer ${process.env.IBM_QUANTUM_TOKEN ?? ""}` } });
    if (!response.ok) throw new Error(`IBM cancellation failed (${response.status}).`);
    return;
  }
  if (backendId === "ionq-aria-1") {
    const response = await fetch(`https://api.ionq.co/v0.4/jobs/${encodeURIComponent(providerJobId)}`, { method: "DELETE", headers: ionqHeaders() });
    if (!response.ok) throw new Error(`IonQ cancellation failed (${response.status}).`);
    return;
  }
  const device = BRAKET_DEVICES[backendId];
  if (device) {
    await new BraketClient({ region: device.region }).send(new CancelQuantumTaskCommand({ quantumTaskArn: providerJobId }));
    return;
  }
  throw new Error(`Cancellation adapter for ${backendId} is not enabled.`);
}
