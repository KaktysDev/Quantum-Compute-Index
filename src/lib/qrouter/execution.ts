import { BraketClient, CancelQuantumTaskCommand, CreateQuantumTaskCommand, GetQuantumTaskCommand } from "@aws-sdk/client-braket";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { parseQASM, type CircuitGate } from "quantum-computer-js";
import { simulateCircuit } from "./simulator";
import type { CircuitAnalysis, TranspilationResult } from "./types";

export interface Submission {
  providerJobId: string;
  status: "submitted" | "completed";
  result?: Record<string, unknown>;
}

export interface ProviderStatus {
  status: "submitted" | "processing" | "completed" | "failed" | "cancelled";
  result?: Record<string, unknown>;
  error?: string;
  actualProviderCost?: number;
}

const BRAKET_DEVICES: Record<string, { arn: string; region: string }> = {
  "aws-sv1": { arn: "arn:aws:braket:::device/quantum-simulator/amazon/sv1", region: "us-east-1" },
  "ionq-aria-1": { arn: "arn:aws:braket:us-east-1::device/qpu/ionq/Aria-1", region: "us-east-1" },
  "iqm-garnet": { arn: "arn:aws:braket:eu-north-1::device/qpu/iqm/Garnet", region: "eu-north-1" },
};

const PARTNER_ADAPTERS: Record<string, { url?: string; token?: string; backend: string }> = {
  "xanadu-borealis": { url: process.env.XANADU_EXECUTION_URL, token: process.env.XANADU_API_KEY, backend: "borealis" },
  "quandela-mosaiq": { url: process.env.QUANDELA_EXECUTION_URL, token: process.env.QUANDELA_API_KEY, backend: "MosaiQ" },
  "qi-starmon-5": { url: process.env.QI_EXECUTION_URL, token: process.env.QI_API_KEY, backend: "Starmon-5" },
};

export function qasm2ToQasm3(source: string, includeStandardLibrary = true) {
  return source
    .replace(/OPENQASM\s+2\.0\s*;/i, "OPENQASM 3.0;")
    .replace(/include\s+"qelib1\.inc"\s*;/i, includeStandardLibrary ? 'include "stdgates.inc";' : "")
    .replace(/\bqreg\s+(\w+)\[(\d+)]\s*;/g, "qubit[$2] $1;")
    .replace(/\bcreg\s+(\w+)\[(\d+)]\s*;/g, "bit[$2] $1;")
    .replace(/\bcx\b/g, "cnot")
    .replace(/measure\s+(\w+)\s*->\s*(\w+)\s*;/g, "$2 = measure $1;")
    .replace(/measure\s+(\w+)\[(\d+)]\s*->\s*(\w+)\[(\d+)]\s*;/g, "$3[$4] = measure $1[$2];");
}

async function submitVultr(analysis: CircuitAnalysis, shots: number): Promise<Submission> {
  if (!process.env.VULTR_SIMULATOR_URL) {
    return {
      providerJobId: `local_${crypto.randomUUID()}`,
      status: "completed",
      result: await simulateCircuit(analysis, shots),
    };
  }
  const response = await fetch(`${process.env.VULTR_SIMULATOR_URL.replace(/\/$/, "")}/v1/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.VULTR_SIMULATOR_TOKEN ?? ""}` },
    body: JSON.stringify({ qasm: analysis.normalizedQasm2, shots }),
  });
  if (!response.ok) throw new Error(`Vultr simulator rejected the job (${response.status}).`);
  const data = await response.json() as { id: string; result?: Record<string, unknown> };
  return { providerJobId: data.id, status: data.result ? "completed" : "submitted", result: data.result };
}

async function submitBraket(backendId: string, analysis: CircuitAnalysis, shots: number, id: string): Promise<Submission> {
  const device = BRAKET_DEVICES[backendId];
  const bucket = process.env.BRAKET_OUTPUT_BUCKET;
  if (!device || !bucket) throw new Error("Amazon Braket is not configured.");
  const response = await new BraketClient({ region: device.region }).send(new CreateQuantumTaskCommand({
    action: JSON.stringify({
      braketSchemaHeader: { name: "braket.ir.openqasm.program", version: "1" },
      source: qasm2ToQasm3(analysis.normalizedQasm2, false),
    }),
    clientToken: id.slice(0, 64),
    deviceArn: device.arn,
    outputS3Bucket: bucket,
    outputS3KeyPrefix: `qrouter/${id}`,
    shots,
    tags: { product: "qrouter", job: id },
  }));
  if (!response.quantumTaskArn) throw new Error("Braket did not return a task ARN.");
  return { providerJobId: response.quantumTaskArn, status: "submitted" };
}

async function submitIbm(transpilation: TranspilationResult | undefined, shots: number): Promise<Submission> {
  const workerUrl = process.env.QROUTER_COMPILER_URL ?? process.env.VULTR_SIMULATOR_URL;
  const qpy = transpilation?.providerProgram?.format === "qpy" ? transpilation.providerProgram.data : null;
  if (!workerUrl || !qpy) throw new Error("IBM execution requires the QRouter compiler service and compiled QPY payload.");
  const response = await fetch(`${workerUrl.replace(/\/$/, "")}/v1/providers/ibm/jobs`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.QROUTER_COMPILER_TOKEN ?? process.env.VULTR_SIMULATOR_TOKEN ?? ""}`, "content-type": "application/json" },
    body: JSON.stringify({ qpy, shots }),
  });
  if (!response.ok) throw new Error(`IBM rejected the job (${response.status}): ${await response.text()}`);
  const data = await response.json() as { id?: string };
  if (!data.id) throw new Error("IBM did not return a job ID.");
  return { providerJobId: data.id, status: "submitted" };
}

function ionqGate(gate: CircuitGate) {
  const name = gate.type.toUpperCase();
  if (name === "CNOT") return { gate: "cnot", control: gate.control, target: gate.target };
  if (name === "SWAP") return { gate: "swap", targets: [gate.target, gate.target2] };
  const names: Record<string, string> = {
    H: "h", X: "x", Y: "y", Z: "z", S: "s", S_DAG: "si", T: "t", T_DAG: "ti",
    RX: "rx", RY: "ry", RZ: "rz",
  };
  const mapped = names[name];
  if (!mapped) throw new Error(`IonQ serializer does not support compiled gate ${gate.type}.`);
  return gate.angle == null
    ? { gate: mapped, target: gate.target }
    : { gate: mapped, target: gate.target, rotation: gate.angle };
}

async function submitIonq(analysis: CircuitAnalysis, shots: number, id: string): Promise<Submission> {
  const token = process.env.IONQ_API_KEY;
  if (!token) return submitBraket("ionq-aria-1", analysis, shots, id);
  const circuit = parseQASM(analysis.normalizedQasm2);
  const response = await fetch("https://api.ionq.co/v0.4/jobs", {
    method: "POST",
    headers: { authorization: `apiKey ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      type: "ionq.circuit.v1",
      name: `QRouter ${id}`,
      shots,
      backend: process.env.IONQ_BACKEND ?? "qpu.aria-1",
      metadata: { qrouter_job_id: id, qrouter_qubits: String(circuit.numQubits) },
      input: { qubits: circuit.numQubits, gateset: "qis", circuit: circuit.gates.map(ionqGate) },
      settings: { error_mitigation: { debiasing: process.env.IONQ_DEBIASING === "true" } },
    }),
  });
  if (!response.ok) throw new Error(`IonQ rejected the job (${response.status}): ${await response.text()}`);
  const data = await response.json() as { id?: string };
  if (!data.id) throw new Error("IonQ did not return a job ID.");
  return { providerJobId: data.id, status: "submitted" };
}

async function submitPartner(backendId: string, analysis: CircuitAnalysis, shots: number, id: string): Promise<Submission> {
  const adapter = PARTNER_ADAPTERS[backendId];
  if (!adapter?.url || !adapter.token) throw new Error(`${backendId} execution bridge is not configured.`);
  const response = await fetch(`${adapter.url.replace(/\/$/, "")}/v1/jobs`, {
    method: "POST",
    headers: { authorization: `Bearer ${adapter.token}`, "content-type": "application/json" },
    body: JSON.stringify({ externalId: id, backend: adapter.backend, qasm: analysis.normalizedQasm2, shots }),
  });
  if (!response.ok) throw new Error(`${backendId} bridge rejected the job (${response.status}): ${await response.text()}`);
  const data = await response.json() as { id?: string; status?: string; result?: Record<string, unknown> };
  if (!data.id) throw new Error(`${backendId} bridge did not return a job ID.`);
  return { providerJobId: data.id, status: data.status === "completed" ? "completed" : "submitted", result: data.result };
}

export async function submitToProvider(backendId: string, analysis: CircuitAnalysis, shots: number, id: string, transpilation?: TranspilationResult): Promise<Submission> {
  if (backendId === "qci-aer-gpu") return submitVultr(analysis, shots);
  if (backendId === "ibm-brisbane") return submitIbm(transpilation, shots);
  if (backendId === "ionq-aria-1") return submitIonq(analysis, shots, id);
  if (BRAKET_DEVICES[backendId]) return submitBraket(backendId, analysis, shots, id);
  if (PARTNER_ADAPTERS[backendId]) return submitPartner(backendId, analysis, shots, id);
  throw new Error(`Execution adapter for ${backendId} is not enabled.`);
}

function normalizeStatus(status: string): ProviderStatus["status"] {
  const value = status.toLowerCase();
  if (["completed", "done", "succeeded", "success"].includes(value)) return "completed";
  if (["failed", "error"].includes(value)) return "failed";
  if (["cancelled", "canceled", "deleted"].includes(value)) return "cancelled";
  if (["running", "executing", "processing", "started"].includes(value)) return "processing";
  return "submitted";
}

async function ionqStatus(id: string): Promise<ProviderStatus> {
  const token = process.env.IONQ_API_KEY!;
  const response = await fetch(`https://api.ionq.co/v0.4/jobs/${encodeURIComponent(id)}`, {
    headers: { authorization: `apiKey ${token}` },
  });
  if (!response.ok) throw new Error(`IonQ status failed (${response.status}).`);
  const job = await response.json() as {
    status: string; shots?: number; failure?: { error?: string; message?: string };
    metadata?: Record<string, string>;
    stats?: { qubits?: number };
    results?: { probabilities?: { url?: string } };
  };
  const status = normalizeStatus(job.status);
  if (status === "failed") return { status, error: job.failure?.message ?? job.failure?.error ?? "IonQ job failed." };
  if (status !== "completed") return { status };
  const resultUrl = job.results?.probabilities?.url;
  let probabilities: Record<string, number> = {};
  if (resultUrl) {
    const resultResponse = await fetch(new URL(resultUrl, "https://api.ionq.co").toString(), {
      headers: { authorization: `apiKey ${token}` },
    });
    if (!resultResponse.ok) throw new Error(`IonQ result retrieval failed (${resultResponse.status}).`);
    const payload = await resultResponse.json() as unknown;
    const envelope = payload as { probabilities?: unknown };
    probabilities = envelope.probabilities && typeof envelope.probabilities === "object"
      ? envelope.probabilities as Record<string, number>
      : payload as Record<string, number>;
  }
  const qubits = Number(job.metadata?.qrouter_qubits ?? job.stats?.qubits ?? 0);
  if (qubits > 0) {
    probabilities = Object.fromEntries(Object.entries(probabilities).map(([state, probability]) => {
      const bitstring = /^\d+$/.test(state) ? BigInt(state).toString(2).padStart(qubits, "0") : state;
      return [bitstring, probability];
    }));
  }
  const shots = job.shots ?? 0;
  const counts = Object.fromEntries(Object.entries(probabilities).map(([state, probability]) => [state, Math.round(probability * shots)]));
  let actualProviderCost: number | undefined;
  try {
    const costResponse = await fetch(`https://api.ionq.co/v0.4/jobs/${encodeURIComponent(id)}/cost`, {
      headers: { authorization: `apiKey ${token}` },
    });
    if (costResponse.ok) {
      const cost = await costResponse.json() as { cost?: number; amount?: number; estimated_cost?: number };
      actualProviderCost = cost.cost ?? cost.amount ?? cost.estimated_cost;
    }
  } catch {
    actualProviderCost = undefined;
  }
  return { status, result: { probabilities, counts, shots, backend: "ionq-aria-1" }, actualProviderCost };
}

async function partnerStatus(backendId: string, id: string): Promise<ProviderStatus> {
  const adapter = PARTNER_ADAPTERS[backendId];
  if (!adapter?.url || !adapter.token) throw new Error(`${backendId} execution bridge is not configured.`);
  const response = await fetch(`${adapter.url.replace(/\/$/, "")}/v1/jobs/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${adapter.token}` },
  });
  if (!response.ok) throw new Error(`${backendId} bridge status failed (${response.status}).`);
  const data = await response.json() as { status: string; result?: Record<string, unknown>; error?: string; actualProviderCost?: number };
  return { status: normalizeStatus(data.status), result: data.result, error: data.error, actualProviderCost: data.actualProviderCost };
}

export async function getProviderStatus(backendId: string, providerJobId: string): Promise<ProviderStatus> {
  if (backendId === "qci-aer-gpu" && process.env.VULTR_SIMULATOR_URL) {
    const response = await fetch(`${process.env.VULTR_SIMULATOR_URL.replace(/\/$/, "")}/v1/jobs/${encodeURIComponent(providerJobId)}`, {
      headers: { authorization: `Bearer ${process.env.VULTR_SIMULATOR_TOKEN ?? ""}` },
    });
    if (!response.ok) throw new Error(`Vultr status failed (${response.status}).`);
    return response.json();
  }
  if (backendId === "ionq-aria-1" && process.env.IONQ_API_KEY) return ionqStatus(providerJobId);
  if (backendId === "ibm-brisbane") {
    const workerUrl = process.env.QROUTER_COMPILER_URL ?? process.env.VULTR_SIMULATOR_URL;
    if (!workerUrl) throw new Error("IBM status requires the QRouter compiler service.");
    const response = await fetch(`${workerUrl.replace(/\/$/, "")}/v1/providers/ibm/jobs/${encodeURIComponent(providerJobId)}`, { headers: { authorization: `Bearer ${process.env.QROUTER_COMPILER_TOKEN ?? process.env.VULTR_SIMULATOR_TOKEN ?? ""}` } });
    if (!response.ok) throw new Error(`IBM status failed (${response.status}).`);
    return response.json();
  }
  const device = BRAKET_DEVICES[backendId];
  if (device) {
    const task = await new BraketClient({ region: device.region }).send(new GetQuantumTaskCommand({ quantumTaskArn: providerJobId }));
    const status = normalizeStatus(task.status ?? "queued");
    if (status === "completed") {
      const object = await new S3Client({ region: device.region }).send(new GetObjectCommand({
        Bucket: task.outputS3Bucket ?? process.env.BRAKET_OUTPUT_BUCKET!,
        Key: `${task.outputS3Directory}/results.json`.replace(/^\//, ""),
      }));
      if (!object.Body) throw new Error("Braket result body is empty.");
      return { status, result: JSON.parse(await object.Body.transformToString()) };
    }
    return { status, error: status === "failed" ? task.failureReason : undefined };
  }
  if (PARTNER_ADAPTERS[backendId]) return partnerStatus(backendId, providerJobId);
  throw new Error(`Status adapter for ${backendId} is not enabled.`);
}

export async function cancelProviderJob(backendId: string, id: string) {
  if (backendId === "ionq-aria-1" && process.env.IONQ_API_KEY) {
    const response = await fetch(`https://api.ionq.co/v0.4/jobs/${encodeURIComponent(id)}/status/cancel`, {
      method: "PUT",
      headers: { authorization: `apiKey ${process.env.IONQ_API_KEY}` },
    });
    if (!response.ok) throw new Error(`IonQ cancellation failed (${response.status}).`);
    return;
  }
  if (backendId === "ibm-brisbane") {
    const workerUrl = process.env.QROUTER_COMPILER_URL ?? process.env.VULTR_SIMULATOR_URL;
    if (!workerUrl) throw new Error("IBM cancellation requires the QRouter compiler service.");
    const response = await fetch(`${workerUrl.replace(/\/$/, "")}/v1/providers/ibm/jobs/${encodeURIComponent(id)}`, { method: "DELETE", headers: { authorization: `Bearer ${process.env.QROUTER_COMPILER_TOKEN ?? process.env.VULTR_SIMULATOR_TOKEN ?? ""}` } });
    if (!response.ok) throw new Error(`IBM cancellation failed (${response.status}).`);
    return;
  }
  const device = BRAKET_DEVICES[backendId];
  if (device) {
    await new BraketClient({ region: device.region }).send(new CancelQuantumTaskCommand({ quantumTaskArn: id }));
    return;
  }
  const partner = PARTNER_ADAPTERS[backendId];
  if (partner?.url && partner.token) {
    const response = await fetch(`${partner.url.replace(/\/$/, "")}/v1/jobs/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${partner.token}` },
    });
    if (!response.ok) throw new Error(`${backendId} bridge cancellation failed (${response.status}).`);
    return;
  }
  throw new Error(`Cancellation adapter for ${backendId} is not enabled.`);
}
