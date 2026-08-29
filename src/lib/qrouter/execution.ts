import { BraketClient, CancelQuantumTaskCommand, CreateQuantumTaskCommand, GetQuantumTaskCommand } from "@aws-sdk/client-braket";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getBackend } from "./catalog";
import { evaluateParam } from "./dialects";
import { nativeProgramFor } from "./encoding/native";
import type { ExecutionBundle } from "./encoding/types";
import { simulateCircuit } from "./simulator";
import type { CircuitAnalysis } from "./types";

export interface Submission { providerJobId: string; status: "submitted" | "completed"; result?: Record<string, unknown> }
export interface ProviderStatus { status: "submitted" | "processing" | "completed" | "failed" | "cancelled"; result?: Record<string, unknown>; error?: string; actualProviderCost?: number }

const BRAKET_DEVICES: Record<string, { arn: string; region: string }> = {
  "aws-sv1": { arn: "arn:aws:braket:::device/quantum-simulator/amazon/sv1", region: "us-east-1" },
  "ionq-aria-1": { arn: "arn:aws:braket:us-east-1::device/qpu/ionq/Aria-1", region: "us-east-1" },
  "iqm-garnet": { arn: "arn:aws:braket:eu-north-1::device/qpu/iqm/Garnet", region: "eu-north-1" },
  "rigetti-ankaa-3": { arn: "arn:aws:braket:us-west-1::device/qpu/rigetti/Ankaa-3", region: "us-west-1" },
};

const providerTimeout = () => AbortSignal.timeout(Number(process.env.QROUTER_PROVIDER_TIMEOUT_MS ?? 20_000));

/**
 * Converts core-gate OpenQASM 2 to OpenQASM 3. Braket's dialect names the CNOT
 * gate `cnot`, while the standard-library dialect (stdgates.inc, used by IBM)
 * keeps `cx` — so the rename is dialect-specific.
 */
const BRAKET_GATE_NAMES: Record<string, string> = {
  cx: "cnot", cnot: "cnot",
  sdg: "si", si: "si",
  tdg: "ti", ti: "ti",
  ccx: "ccnot", toffoli: "ccnot", ccnot: "ccnot",
  id: "i",
};

export function qasm2ToQasm3(source: string, dialect: "braket" | "stdgates" = "braket") {
  let output = source
    .replace(/OPENQASM\s+2\.0\s*;/i, "OPENQASM 3.0;")
    .replace(/include\s+"qelib1\.inc"\s*;/i, 'include "stdgates.inc";')
    .replace(/\bqreg\s+(\w+)\[(\d+)]\s*;/g, "qubit[$2] $1;")
    .replace(/\bcreg\s+(\w+)\[(\d+)]\s*;/g, "bit[$2] $1;")
    .replace(/measure\s+(\w+)\s*->\s*(\w+)\s*;/g, "$2 = measure $1;")
    .replace(/measure\s+(\w+)\[(\d+)]\s*->\s*(\w+)\[(\d+)]\s*;/g, "$3[$4] = measure $1[$2];");
  if (dialect === "braket") {
    output = output.replace(/^\s*include\s+"stdgates\.inc"\s*;\s*$/im, "");
    output = output.replace(/\b(cx|cnot|sdg|si|tdg|ti|ccx|toffoli|ccnot|id)\b/g, (name) => BRAKET_GATE_NAMES[name] ?? name);
    output = output.replace(/\bu1\s*\(([^)]+)\)/g, "rz($1)");
    output = output.replace(/\bu2\s*\(([^,]+),([^)]+)\)/g, (_, phi, lambda) => `rz(${lambda.trim()}); ry(pi/2); rz(${phi.trim()})`);
  }
  return output;
}

async function submitVultr(analysis: CircuitAnalysis, shots: number, idempotencyKey: string): Promise<Submission> {
  const endpoint = process.env.VULTR_SIMULATOR_URL;
  if (!endpoint) {
    return { providerJobId: `local_${crypto.randomUUID()}`, status: "completed", result: simulateCircuit(analysis, shots) as unknown as Record<string, unknown> };
  }
  const response = await fetch(`${endpoint.replace(/\/$/, "")}/v1/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.VULTR_SIMULATOR_TOKEN ?? ""}`, "idempotency-key": idempotencyKey },
    body: JSON.stringify({ qasm: analysis.normalizedQasm2, shots }),
    signal: providerTimeout(),
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

async function submitIbm(backendId: string, analysis: CircuitAnalysis, shots: number, bundle?: Pick<ExecutionBundle, "media_type" | "payload">): Promise<Submission> {
  const token = process.env.IBM_QUANTUM_TOKEN;
  if (!token) throw new Error("IBM Quantum is not configured.");
  const routed = getBackend(backendId);
  const backendName = routed?.backendName ?? process.env.IBM_QUANTUM_BACKEND ?? "ibm_brisbane";
  const workerUrl = process.env.QROUTER_COMPILER_URL ?? process.env.VULTR_SIMULATOR_URL;
  const qpy = bundle?.media_type === "application/qpy" ? bundle.payload : null;
  if (workerUrl && qpy) {
    const parsed = JSON.parse(qpy) as { data?: string };
    const response = await fetch(`${workerUrl.replace(/\/$/, "")}/v1/providers/ibm/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.QROUTER_COMPILER_TOKEN ?? process.env.VULTR_SIMULATOR_TOKEN ?? ""}` },
      body: JSON.stringify({ qpy: parsed.data ?? qpy, shots, backend_name: backendName }),
      signal: providerTimeout(),
    });
    if (!response.ok) throw new Error(`IBM Quantum (compiler worker) rejected the job (${response.status}): ${await response.text()}`);
    const data = await response.json() as { id?: string };
    if (!data.id) throw new Error("IBM Quantum did not return a job ID.");
    return { providerJobId: data.id, status: "submitted" };
  }
  const [hub, group, project] = (process.env.IBM_QUANTUM_INSTANCE ?? "ibm-q/open/main").split("/");
  const response = await fetch("https://api.quantum-computing.ibm.com/runtime/jobs", {
    method: "POST",
    headers: { accept: "application/json", authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      program_id: "sampler", backend: backendName, hub, group, project,
      params: { pubs: [[qasm2ToQasm3(analysis.normalizedQasm2, "stdgates")]], options: { default_shots: shots }, version: 2 },
    }),
    signal: providerTimeout(),
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

/**
 * Converts core-gate OpenQASM 2 (the output of dialect expansion + transpile)
 * into IonQ's QIS gate JSON. Throws on anything it cannot faithfully express so
 * a circuit is never silently altered before hardware execution.
 */
export function qasm2ToIonqCircuit(source: string) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
  const offsets = new Map<string, { offset: number; size: number }>();
  let total = 0;
  for (const match of text.matchAll(/\bqreg\s+([A-Za-z_][A-Za-z0-9_]*)\s*\[(\d+)]/g)) {
    offsets.set(match[1], { offset: total, size: Number(match[2]) });
    total += Number(match[2]);
  }

  const wire = (argument: string): number[] => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[(\d+)])?$/.exec(argument.trim());
    const register = match ? offsets.get(match[1]) : undefined;
    if (!match || !register) throw new Error(`IonQ conversion failed: unknown qubit "${argument.trim()}".`);
    if (match[2] === undefined) return Array.from({ length: register.size }, (_, index) => register.offset + index);
    const index = Number(match[2]);
    if (index >= register.size) throw new Error(`IonQ conversion failed: qubit index out of range in "${argument.trim()}".`);
    return [register.offset + index];
  };

  const gates: Array<Record<string, unknown>> = [];
  const single = (gate: string, target: number, rotation?: number) =>
    gates.push(rotation === undefined ? { gate, target } : { gate, rotation, target });
  const cnot = (control: number, target: number) => gates.push({ gate: "cnot", control, target });
  const u3 = (target: number, theta: number, phi: number, lambda: number) => {
    single("rz", target, lambda);
    single("ry", target, theta);
    single("rz", target, phi);
  };
  const toffoli = (a: number, b: number, c: number) => {
    single("h", c); cnot(b, c); single("ti", c); cnot(a, c); single("t", c); cnot(b, c); single("ti", c);
    cnot(a, c); single("t", b); single("t", c); single("h", c); cnot(a, b); single("t", a); single("ti", b); cnot(a, b);
  };

  for (const rawStatement of text.split(";")) {
    const statement = rawStatement.trim();
    if (!statement) continue;
    if (/^(OPENQASM|include|qreg|creg|barrier)\b/i.test(statement)) continue;
    if (/^measure\b/i.test(statement)) continue;
    if (/^if\s*\(/.test(statement)) throw new Error("IonQ conversion failed: classically-controlled gates are not supported.");
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?\s+(.+)$/s.exec(statement);
    if (!match) throw new Error(`IonQ conversion failed: could not parse "${statement.slice(0, 60)}".`);
    const name = match[1].toLowerCase();
    const params = (match[2] ?? "").split(",").map((piece) => piece.trim()).filter(Boolean).map(evaluateParam);
    const argRows = match[3].split(",").map((argument) => wire(argument));
    const arity = argRows.length;
    const broadcast = Math.max(...argRows.map((row) => row.length));
    if (argRows.some((row) => row.length !== 1 && row.length !== broadcast)) {
      throw new Error(`IonQ conversion failed: mismatched register sizes in "${statement.slice(0, 60)}".`);
    }
    for (let step = 0; step < broadcast; step += 1) {
      const wires = argRows.map((row) => (row.length === 1 ? row[0] : row[step]));
      const [a, b, c] = wires;
      if (arity === 1) {
        if (["h", "x", "y", "z", "s", "t"].includes(name)) single(name, a);
        else if (name === "sdg") single("si", a);
        else if (name === "tdg") single("ti", a);
        else if (name === "sx" || name === "v") single("v", a);
        else if (name === "sxdg" || name === "vi") single("vi", a);
        else if (name === "id") continue;
        else if (["rx", "ry", "rz"].includes(name)) single(name, a, params[0]);
        else if (name === "u1" || name === "p") single("rz", a, params[0]);
        else if (name === "u2") u3(a, Math.PI / 2, params[0], params[1]);
        else if (name === "u3" || name === "u") u3(a, params[0], params[1], params[2]);
        else throw new Error(`IonQ conversion failed: gate "${name}" is not supported.`);
      } else if (arity === 2) {
        if (name === "cx" || name === "cnot") cnot(a, b);
        else if (name === "cz") { single("h", b); cnot(a, b); single("h", b); }
        else if (name === "swap") gates.push({ gate: "swap", targets: [a, b] });
        else throw new Error(`IonQ conversion failed: gate "${name}" is not supported.`);
      } else if (arity === 3 && (name === "ccx" || name === "toffoli")) {
        toffoli(a, b, c);
      } else {
        throw new Error(`IonQ conversion failed: gate "${name}" is not supported.`);
      }
    }
  }
  return gates;
}

/** Classical mapping that qasm2ToIonqCircuit must not drop (D5). */
export function ionqMeasurementMap(source: string) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
  const qOffsets = new Map<string, { offset: number; size: number }>();
  const cOffsets = new Map<string, { offset: number; size: number }>();
  let qTotal = 0;
  let cTotal = 0;
  for (const match of text.matchAll(/\bqreg\s+([A-Za-z_][A-Za-z0-9_]*)\s*\[(\d+)]/g)) {
    qOffsets.set(match[1], { offset: qTotal, size: Number(match[2]) });
    qTotal += Number(match[2]);
  }
  for (const match of text.matchAll(/\bcreg\s+([A-Za-z_][A-Za-z0-9_]*)\s*\[(\d+)]/g)) {
    cOffsets.set(match[1], { offset: cTotal, size: Number(match[2]) });
    cTotal += Number(match[2]);
  }
  const map: Array<{ qubit: number; clbit: number }> = [];
  for (const match of text.matchAll(/\bmeasure\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[(\d+)])?\s*->\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[(\d+)])?\s*;/g)) {
    const q = qOffsets.get(match[1]);
    const c = cOffsets.get(match[3]);
    if (!q || !c) throw new Error(`IonQ conversion failed: measurement map is missing a register in "${match[0]}".`);
    if (match[2] !== undefined && match[4] !== undefined) {
      map.push({ qubit: q.offset + Number(match[2]), clbit: c.offset + Number(match[4]) });
    } else {
      const width = Math.min(q.size, c.size);
      for (let index = 0; index < width; index += 1) map.push({ qubit: q.offset + index, clbit: c.offset + index });
    }
  }
  if (!map.length) throw new Error("IonQ conversion failed: the measurement map is empty; a circuit is never submitted without its classical mapping.");
  return map;
}

async function submitIonq(analysis: CircuitAnalysis, shots: number, jobId: string): Promise<Submission> {
  const measurement_map = ionqMeasurementMap(analysis.normalizedQasm2);
  const response = await fetch("https://api.ionq.co/v0.4/jobs", {
    method: "POST",
    headers: ionqHeaders(),
    body: JSON.stringify({
      name: jobId,
      type: "ionq.circuit.v1",
      shots,
      metadata: { qrouter_qubits: String(analysis.qubits), qrouter_job_id: jobId, qrouter_measurement_map: JSON.stringify(measurement_map) },
      input: {
        qubits: analysis.qubits,
        gateset: "qis",
        circuit: qasm2ToIonqCircuit(analysis.normalizedQasm2),
        registers: { meas: { qubits: measurement_map.map((item) => item.qubit) } },
      },
    }),
    signal: providerTimeout(),
  });
  if (!response.ok) throw new Error(`IonQ rejected the job (${response.status}): ${await response.text()}`);
  const data = await response.json() as { id?: string };
  if (!data.id) throw new Error("IonQ did not return a job ID.");
  return { providerJobId: data.id, status: "submitted" };
}

const EXECUTION_BRIDGES: Record<string, { name: string; url: () => string | undefined; token: () => string | undefined }> = {
  "xanadu-borealis": { name: "Xanadu", url: () => process.env.XANADU_EXECUTION_URL, token: () => process.env.XANADU_API_KEY },
  "quandela-mosaiq": { name: "Quandela", url: () => process.env.QUANDELA_EXECUTION_URL, token: () => process.env.QUANDELA_API_KEY },
  "qi-starmon-5": { name: "Quantum Inspire", url: () => process.env.QI_EXECUTION_URL, token: () => process.env.QI_API_KEY },
};

function bridgeAuth(backendId: string) {
  const bridge = EXECUTION_BRIDGES[backendId];
  if (!bridge) return null;
  const url = bridge.url()?.replace(/\/$/, "");
  const token = bridge.token();
  if (!url || !token) return null;
  return { name: bridge.name, url, token };
}

async function submitExecutionBridge(backendId: string, analysis: CircuitAnalysis, shots: number, idempotencyKey: string): Promise<Submission> {
  const bridge = bridgeAuth(backendId);
  if (!bridge) throw new Error(`${EXECUTION_BRIDGES[backendId]?.name ?? backendId} is not configured.`);
  const backend = { id: backendId, provider: backendId === "qi-starmon-5" ? "quantum-inspire" : backendId === "xanadu-borealis" ? "xanadu" : "quandela", displayName: bridge.name };
  const encoding = nativeProgramFor(backend, analysis.normalizedQasm2);
  const response = await fetch(`${bridge.url}/v1/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bridge.token}`, "idempotency-key": idempotencyKey },
    body: JSON.stringify({ qasm: analysis.normalizedQasm2, shots, backend_id: backendId, encoding }),
    signal: providerTimeout(),
  });
  if (!response.ok) throw new Error(`${bridge.name} rejected the job (${response.status}): ${await response.text()}`);
  const data = await response.json() as { id?: string; providerJobId?: string; result?: Record<string, unknown> };
  const providerJobId = data.id ?? data.providerJobId;
  if (!providerJobId) throw new Error(`${bridge.name} did not return a job ID.`);
  return { providerJobId, status: data.result ? "completed" : "submitted", result: data.result };
}

async function getExecutionBridgeStatus(backendId: string, providerJobId: string): Promise<ProviderStatus> {
  const bridge = bridgeAuth(backendId);
  if (!bridge) throw new Error(`${EXECUTION_BRIDGES[backendId]?.name ?? backendId} is not configured.`);
  const response = await fetch(`${bridge.url}/v1/jobs/${encodeURIComponent(providerJobId)}`, {
    headers: { authorization: `Bearer ${bridge.token}` }, signal: providerTimeout(),
  });
  if (!response.ok) throw new Error(`${bridge.name} status request failed (${response.status}).`);
  return response.json() as Promise<ProviderStatus>;
}

async function cancelExecutionBridge(backendId: string, providerJobId: string) {
  const bridge = bridgeAuth(backendId);
  if (!bridge) throw new Error(`${EXECUTION_BRIDGES[backendId]?.name ?? backendId} is not configured.`);
  const response = await fetch(`${bridge.url}/v1/jobs/${encodeURIComponent(providerJobId)}`, {
    method: "DELETE", headers: { authorization: `Bearer ${bridge.token}` }, signal: providerTimeout(),
  });
  if (!response.ok) throw new Error(`${bridge.name} cancellation failed (${response.status}).`);
}

function qiBase() {
  return (process.env.QI_API_BASE ?? "https://api.quantum-inspire.com").replace(/\/$/, "");
}

function qiHeaders() {
  const token = process.env.QI_API_KEY;
  if (!token) throw new Error("Quantum Inspire is not configured.");
  return { accept: "application/json", "content-type": "application/json", authorization: `Token ${token}` };
}

async function qiFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(`${qiBase()}${path}`, { ...init, headers: { ...qiHeaders(), ...(init.headers ?? {}) }, signal: providerTimeout() });
  if (!response.ok) throw new Error(`Quantum Inspire request failed (${response.status}): ${await response.text()}`);
  if (response.status === 204) return null;
  return response.json() as Promise<unknown>;
}

function qiList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object" && Array.isArray((payload as { results?: unknown }).results)) {
    return (payload as { results: T[] }).results;
  }
  return [];
}

function qiJobId(value: unknown) {
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    const match = /\/(\d+)\/?$/.exec(value);
    return match ? match[1] : value;
  }
  return "";
}

type QiBackendType = { url?: string; name?: string; is_hardware_backend?: boolean };
type QiEntity = { url?: string; id?: number | string };

async function submitQuantumInspire(analysis: CircuitAnalysis, shots: number, jobId: string): Promise<Submission> {
  const encoding = nativeProgramFor({ id: "qi-starmon-5", provider: "quantum-inspire", displayName: "Starmon-5" }, analysis.normalizedQasm2);
  const wanted = (process.env.QI_BACKEND ?? "Starmon-5").toLowerCase();
  const backends = qiList<QiBackendType>(await qiFetch("/backendtypes/"));
  const backend = backends.find((item) => (item.name ?? "").toLowerCase() === wanted)
    ?? backends.find((item) => /starmon/i.test(item.name ?? ""));
  if (!backend?.url) throw new Error(`Quantum Inspire has no backend matching "${process.env.QI_BACKEND ?? "Starmon-5"}".`);
  const project = await qiFetch("/projects/", {
    method: "POST",
    body: JSON.stringify({ name: `qrouter-${jobId}`.slice(0, 80), backend_type: backend.url, default_number_of_shots: shots }),
  }) as QiEntity;
  if (!project.url) throw new Error("Quantum Inspire did not return a project URL.");
  const asset = await qiFetch("/assets/", {
    method: "POST",
    body: JSON.stringify({ name: "circuit", project: project.url, content: encoding.format === "cqasm-1.0" ? encoding.source : analysis.normalizedQasm2 }),
  }) as QiEntity;
  if (!asset.url) throw new Error("Quantum Inspire did not return an asset URL.");
  const job = await qiFetch("/jobs/", {
    method: "POST",
    body: JSON.stringify({ name: jobId, input: asset.url, backend_type: backend.url, number_of_shots: shots }),
  }) as QiEntity & { url?: string };
  const providerJobId = qiJobId(job.id) || qiJobId(job.url);
  if (!providerJobId) throw new Error("Quantum Inspire did not return a job ID.");
  return { providerJobId, status: "submitted" };
}

function qiStatusFrom(raw: string): ProviderStatus["status"] {
  const status = raw.toLowerCase();
  if (["complete", "completed", "success"].includes(status)) return "completed";
  if (["failed", "error", "execution_failed", "cancelled_due_to_failed"].includes(status)) return "failed";
  if (["cancelled", "canceled"].includes(status)) return "cancelled";
  if (["running", "executing", "processing"].includes(status)) return "processing";
  return "submitted";
}

async function getQuantumInspireStatus(providerJobId: string): Promise<ProviderStatus> {
  const job = await qiFetch(`/jobs/${encodeURIComponent(providerJobId)}/`) as {
    status?: string; results?: string; failure_reason?: string; error?: string;
  };
  const status = qiStatusFrom(job.status ?? "submitted");
  if (status === "failed") return { status, error: job.failure_reason ?? job.error ?? "Quantum Inspire job failed." };
  if (status !== "completed") return { status };
  const resultUrl = typeof job.results === "string" ? job.results : `${qiBase()}/jobs/${encodeURIComponent(providerJobId)}/result/`;
  const path = resultUrl.startsWith("http") ? new URL(resultUrl).pathname : resultUrl;
  const result = await qiFetch(path.startsWith("/") ? path : `/${path}`) as {
    histogram?: Record<string, number>;
    histogram_qubit_count?: number;
  };
  return { status: "completed", result: { probabilities: result.histogram ?? {}, metadata: { histogramQubitCount: result.histogram_qubit_count } } };
}

async function cancelQuantumInspire(providerJobId: string) {
  await qiFetch(`/jobs/${encodeURIComponent(providerJobId)}/`, { method: "DELETE" });
}

export async function submitToProvider(backendId: string, analysis: CircuitAnalysis, shots: number, jobId: string, bundle?: Pick<ExecutionBundle, "media_type" | "payload">): Promise<Submission> {
  if (backendId === "qci-aer-gpu") return submitVultr(analysis, shots, jobId);
  if (backendId === "ibm-brisbane" || backendId.startsWith("ibm-")) return submitIbm(backendId, analysis, shots, bundle);
  if (backendId === "ionq-aria-1" && process.env.IONQ_API_KEY) return submitIonq(analysis, shots, jobId);
  if (BRAKET_DEVICES[backendId]) return submitBraket(backendId, analysis, shots, jobId);
  if (bridgeAuth(backendId)) return submitExecutionBridge(backendId, analysis, shots, jobId);
  if (backendId === "qi-starmon-5" && process.env.QI_API_KEY) return submitQuantumInspire(analysis, shots, jobId);
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
  const response = await fetch(`https://api.ionq.co/v0.4/jobs/${encodeURIComponent(providerJobId)}`, { headers: ionqHeaders(), signal: providerTimeout() });
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
      const resultResponse = await fetch(probabilitySource.url, { headers: ionqHeaders(), signal: providerTimeout() });
      if (!resultResponse.ok) throw new Error(`IonQ result request failed (${resultResponse.status}).`);
      probabilities = await resultResponse.json() as Record<string, number>;
    } else if (probabilitySource) {
      probabilities = probabilitySource as Record<string, number>;
    }
    const normalized = normalizeIonqProbabilities(probabilities, qubits);
    const shots = data.shots ?? 0;
    const counts = Object.fromEntries(Object.entries(normalized).map(([state, probability]) => [state, Math.round(probability * shots)]));
    let actualProviderCost: number | undefined;
    const costResponse = await fetch(`https://api.ionq.co/v0.4/jobs/${encodeURIComponent(providerJobId)}/cost`, { headers: ionqHeaders(), signal: providerTimeout() });
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
    const response = await fetch(`${process.env.VULTR_SIMULATOR_URL.replace(/\/$/, "")}/v1/jobs/${encodeURIComponent(providerJobId)}`, { headers: { authorization: `Bearer ${process.env.VULTR_SIMULATOR_TOKEN ?? ""}` }, signal: providerTimeout() });
    if (!response.ok) throw new Error(`Vultr status request failed (${response.status}).`);
    return response.json() as Promise<ProviderStatus>;
  }
  if (backendId === "ibm-brisbane") {
    const response = await fetch(`https://api.quantum-computing.ibm.com/runtime/jobs/${encodeURIComponent(providerJobId)}`, { headers: { accept: "application/json", authorization: `Bearer ${process.env.IBM_QUANTUM_TOKEN ?? ""}` }, signal: providerTimeout() });
    if (!response.ok) throw new Error(`IBM status request failed (${response.status}).`);
    const data = await response.json() as { state?: { status?: string; reason?: string }; status?: string; results?: Record<string, unknown> };
    const raw = (data.state?.status ?? data.status ?? "queued").toLowerCase();
    if (["completed", "done"].includes(raw)) return { status: "completed", result: data.results ?? { providerJobId, message: "Results are available from IBM Runtime." } };
    if (["failed", "error"].includes(raw)) return { status: "failed", error: data.state?.reason ?? "IBM job failed." };
    if (["cancelled", "canceled"].includes(raw)) return { status: "cancelled" };
    return { status: ["running", "executing"].includes(raw) ? "processing" : "submitted" };
  }
  if (backendId === "ionq-aria-1" && !providerJobId.startsWith("arn:aws:braket:")) return getIonqStatus(providerJobId);
  if (bridgeAuth(backendId)) return getExecutionBridgeStatus(backendId, providerJobId);
  if (backendId === "qi-starmon-5" && process.env.QI_API_KEY) return getQuantumInspireStatus(providerJobId);
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
    const response = await fetch(`${process.env.VULTR_SIMULATOR_URL.replace(/\/$/, "")}/v1/jobs/${encodeURIComponent(providerJobId)}`, { method: "DELETE", headers: { authorization: `Bearer ${process.env.VULTR_SIMULATOR_TOKEN ?? ""}` }, signal: providerTimeout() });
    if (!response.ok) throw new Error(`Vultr cancellation failed (${response.status}).`);
    return;
  }
  if (backendId === "ibm-brisbane") {
    const response = await fetch(`https://api.quantum-computing.ibm.com/runtime/jobs/${encodeURIComponent(providerJobId)}/cancel`, { method: "POST", headers: { authorization: `Bearer ${process.env.IBM_QUANTUM_TOKEN ?? ""}` }, signal: providerTimeout() });
    if (!response.ok) throw new Error(`IBM cancellation failed (${response.status}).`);
    return;
  }
  if (backendId === "ionq-aria-1" && !providerJobId.startsWith("arn:aws:braket:")) {
    const response = await fetch(`https://api.ionq.co/v0.4/jobs/${encodeURIComponent(providerJobId)}`, { method: "DELETE", headers: ionqHeaders(), signal: providerTimeout() });
    if (!response.ok) throw new Error(`IonQ cancellation failed (${response.status}).`);
    return;
  }
  if (bridgeAuth(backendId)) {
    await cancelExecutionBridge(backendId, providerJobId);
    return;
  }
  if (backendId === "qi-starmon-5" && process.env.QI_API_KEY) {
    await cancelQuantumInspire(providerJobId);
    return;
  }
  const device = BRAKET_DEVICES[backendId];
  if (device) {
    await new BraketClient({ region: device.region }).send(new CancelQuantumTaskCommand({ quantumTaskArn: providerJobId }));
    return;
  }
  throw new Error(`Cancellation adapter for ${backendId} is not enabled.`);
}
