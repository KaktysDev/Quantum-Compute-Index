/**
 * Client-safe encoding plan. Describes what the selected platform parameters
 * will do — encoder, transform, resources, next step — without importing
 * adapter internals or shipping a native program.
 */

import { BACKENDS, getBackend } from "../catalog";
import type { Backend } from "../types";
import { bitOrderLabel, compileChange, gateCount, quoteBindingLabel, verificationLabel, whyRouted, workloadLabel } from "./public";
import type { EncodingTrace } from "./types";

export type EncodingModality = "simulator" | "superconducting" | "trapped-ion" | "photonic";
export type EncoderFamily =
  | "aer-qasm2"
  | "ibm-isa"
  | "ionq-qis"
  | "braket-qasm3"
  | "photonic-dual-rail"
  | "cqasm-1.0"
  | "pending-route";
export type EncodingPreviewPhase = "quoting" | "ready" | "running" | "done" | "failed";

export const MODALITY_LABEL: Record<EncodingModality, string> = {
  simulator: "Simulator",
  superconducting: "Superconducting",
  "trapped-ion": "Trapped ion",
  photonic: "Photonic",
};

export interface EncodingPreviewInput {
  targetId?: string;
  selectedId?: string;
  shots?: number;
  format?: "openqasm2" | "openqasm3";
  routingMode?: string;
  kind?: "qpu" | "simulator";
  qubits?: number;
  depth?: number;
  gates?: number;
  encoding?: EncodingTrace;
  transpilation?: { before: { depth: number; gates: number }; after: { depth: number; gates: number } };
  candidates?: Array<{
    backend: { id: string; displayName: string };
    compatible: boolean;
    score: number;
    rejectionReasons: string[];
  }>;
  explanation?: string[];
  error?: string;
  phase?: EncodingPreviewPhase;
  updating?: boolean;
  sourceBytes?: number;
  jobStatus?: string;
}

export interface EncodingPreviewResource {
  key: string;
  label: string;
  value: string;
}

export interface EncodingPreviewParameter {
  name: string;
  value: string;
  effect: string;
}

export interface EncodingPreviewMapping {
  label: string;
  detail: string;
}

export interface EncodingPreviewPlan {
  encodingId: EncoderFamily;
  encodingLabel: string;
  headline: string;
  why: string;
  transform: string;
  nextStep: string;
  modality: EncodingModality;
  modalityLabel: string;
  backendId?: string;
  backendName?: string;
  mediaType: string;
  formatLabel: string;
  shots?: number;
  resources: EncodingPreviewResource[];
  parameters: EncodingPreviewParameter[];
  mappings: EncodingPreviewMapping[];
  warnings: string[];
  source: "trace" | "catalog" | "pending";
  error?: string;
  phase: EncodingPreviewPhase;
}

interface EncoderProfile {
  family: EncoderFamily;
  label: string;
  mediaType: string;
  why: string;
  transform: string;
  nextAfterEncode: string;
  extraWarnings: string[];
}

export function modalityOf(backend: Pick<Backend, "kind" | "provider">): EncodingModality {
  if (backend.kind === "simulator") return "simulator";
  if (backend.provider === "ionq") return "trapped-ion";
  if (backend.provider === "xanadu" || backend.provider === "quandela") return "photonic";
  return "superconducting";
}

export function formatPayloadBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes >= 10_240 ? 0 : 1)} KB`;
}

export function formatMediaType(mediaType: string | undefined): string {
  if (mediaType === "text/qasm2") return "OpenQASM 2";
  if (mediaType === "text/qasm3") return "OpenQASM 3";
  if (mediaType === "application/qpy") return "QPY";
  if (mediaType === "application/json") return "JSON program";
  if (mediaType === "text/cqasm") return "cQASM 1.0";
  return mediaType || "—";
}

export function encoderProfile(backend: Backend): EncoderProfile {
  switch (backend.provider) {
    case "qci":
      return {
        family: "aer-qasm2",
        label: "Aer OpenQASM 2",
        mediaType: "text/qasm2",
        why: "Aer consumes the compiled OpenQASM 2 program. No native-format rewrite.",
        transform: "Dialect expansion, then transpile to Aer’s basis. The submitted bytes stay OpenQASM 2.",
        nextAfterEncode: "The dispatcher submits the QASM 2 bundle to Aer and decodes counts in q0-right order.",
        extraWarnings: [],
      };
    case "ibm":
      return {
        family: "ibm-isa",
        label: "IBM ISA (QPY / OpenQASM 3)",
        mediaType: "application/qpy",
        why: "IBM Runtime requires an ISA circuit for the routed backend Target — not the source QASM as pasted.",
        transform: "Transpile onto the backend ISA (basis + coupling). Prefer the QPY artifact; otherwise emit OpenQASM 3.",
        nextAfterEncode: "Routing submits the hashed bundle to the selected IBM backend. Results are decoded with the layout map.",
        extraWarnings: ["Heavy-hex connectivity can insert SWAP routing. Depth after encode is the one that runs."],
      };
    case "ionq":
      return {
        family: "ionq-qis",
        label: "IonQ QIS JSON",
        mediaType: "application/json",
        why: "IonQ’s API accepts QIS JSON with an explicit measurement map — not raw OpenQASM.",
        transform: "Compiled QASM is wrapped as QIS JSON. Measurement pairs are required; an empty map is refused.",
        nextAfterEncode: "The JSON bundle is posted to IonQ. Keys arrive q0-left and are normalised to QRouter’s q0-right convention.",
        extraWarnings: [],
      };
    case "aws-braket":
      return {
        family: "braket-qasm3",
        label: "Braket OpenQASM 3",
        mediaType: "text/qasm3",
        why: "Amazon Braket (SV1, Rigetti, IQM) consumes device-specific OpenQASM 3.",
        transform: "Transpile to the device basis, then emit OpenQASM 3 with Braket gate names (cx → cnot, and so on).",
        nextAfterEncode: "The bundle is submitted to Braket for the selected device; decode keeps the platform bit order.",
        extraWarnings: backend.connectivity !== "all-to-all"
          ? ["This device is not all-to-all. Two-qubit gates may be routed."]
          : [],
      };
    case "xanadu":
    case "quandela":
      return {
        family: "photonic-dual-rail",
        label: "Photonic dual-rail",
        mediaType: "application/json",
        why: "Photonic backends do not run gate-model QASM. The encoder builds an explicit dual-rail native-input program.",
        transform: "Each logical qubit occupies two optical modes. Single-qubit gates become beamsplitters and phases; unsupported gates fail closed.",
        nextAfterEncode: "The native-input bridge executes the photonic program. Decode may include photon patterns as well as counts.",
        extraWarnings: ["Modes = 2 × logical qubits. This is a different computation surface, not a silent Qiskit rewrite."],
      };
    case "quantum-inspire":
      return {
        family: "cqasm-1.0",
        label: "cQASM 1.0",
        mediaType: "text/cqasm",
        why: "Starmon-5’s compiler accepts cQASM 1.0, not OpenQASM.",
        transform: "Core-gate OpenQASM 2 is rewritten to cQASM (H, CNOT, Measure_z, …). Unknown gates fail closed.",
        nextAfterEncode: "The cQASM bundle is submitted to Quantum Inspire and decoded in q0-right order.",
        extraWarnings: backend.couplingMap?.length
          ? ["Starmon-5 is a plus-shaped chip. Two-qubit gates that are not on the hub need routing."]
          : [],
      };
    default:
      return {
        family: "pending-route",
        label: "Provider encoder",
        mediaType: "text/qasm2",
        why: "This backend has a catalog entry but no published encoder profile in the preview.",
        transform: "The encoding layer will lower the program against the adapter that claims this backend.",
        nextAfterEncode: "After encode, the router quotes and the dispatcher submits the hashed bundle.",
        extraWarnings: [],
      };
  }
}

export function encodingTargets() {
  return BACKENDS.map((backend) => {
    const profile = encoderProfile(backend);
    return {
      id: backend.id,
      displayName: backend.displayName,
      kind: backend.kind,
      modality: modalityOf(backend),
      encodingLabel: profile.label,
      qubits: backend.qubits,
    };
  });
}

const PENDING: EncoderProfile = {
  family: "pending-route",
  label: "Encoder pending route",
  mediaType: "",
  why: "QRouter scores compatible backends first. The encoder is chosen for the winner — it is not applied before a target exists.",
  transform: "Analyze the program, prune backends that cannot run it, compile the primary plus failover candidates, then encode for the selected machine.",
  nextAfterEncode: "Once a backend wins, the matching encoder runs, the quote locks, and nothing is submitted until you confirm.",
  extraWarnings: [],
};

export function resolvePreviewBackendId(input: Pick<EncodingPreviewInput, "targetId" | "selectedId">): string | undefined {
  if (input.targetId && input.targetId !== "auto") return input.targetId;
  return input.selectedId;
}

/** A quote's encoding overlay is only valid for the target it was fetched for. */
export function quoteOverlayApplies(quotedTarget: string | null | undefined, currentTarget: string): boolean {
  return Boolean(quotedTarget) && quotedTarget === currentTarget;
}

function computeTypeLabel(kind: EncodingPreviewInput["kind"]): string {
  if (kind === "qpu") return "Physical QPU";
  if (kind === "simulator") return "Simulator";
  return "Any";
}

function labelFor(profile: EncoderProfile, mediaType?: string): string {
  if (profile.family === "ibm-isa" && mediaType === "text/qasm3") return "IBM OpenQASM 3";
  if (profile.family === "ibm-isa" && mediaType === "application/qpy") return "IBM QPY";
  if (profile.family === "photonic-dual-rail") return profile.label;
  return profile.label;
}

function routingEffect(mode: string | undefined): string {
  if (mode === "cost") return "Prefers cheaper compatible backends. The encoder follows the winner.";
  if (mode === "speed") return "Prefers shorter queues. The encoder follows the winner.";
  if (mode === "quality") return "Prefers higher-fidelity machines. The encoder follows the winner.";
  return "Balances cost, queue, and fidelity. The encoder follows the winner.";
}

function nextStepFor(phase: EncodingPreviewPhase, profile: EncoderProfile, jobStatus?: string): string {
  if (phase === "quoting") return "Wait for compile and scoring. Nothing is submitted until you confirm.";
  if (phase === "running") {
    const status = jobStatus?.replaceAll("_", " ");
    return status ? `Execution is ${status}. The hashed bundle is what runs — not a reconstructed circuit.` : profile.nextAfterEncode;
  }
  if (phase === "done") return "Result is decoded with the bundle’s bit order, layout inverse, and measurement map.";
  if (phase === "failed") return "Fix the reported error or pick a compatible backend, then quote again. Nothing was billed unless a reservation already existed.";
  return profile.nextAfterEncode;
}

function headlineFor(input: {
  phase: EncodingPreviewPhase;
  updating?: boolean;
  error?: string;
  encodingLabel: string;
  backendName?: string;
  pending: boolean;
}): string {
  if (input.error) return input.error;
  if (input.phase === "quoting" && input.pending) return "Scoring backends, then encoding for the winner — expand to see the plan.";
  if (input.phase === "quoting") return `Compiling and encoding for ${input.backendName ?? "the selected backend"} with ${input.encodingLabel}.`;
  if (input.updating) return `${input.encodingLabel} on ${input.backendName ?? "this backend"} — refreshing the quote for the new parameters.`;
  if (input.phase === "running") return `Submitting the ${input.encodingLabel} bundle to ${input.backendName ?? "the routed backend"}.`;
  if (input.phase === "done") return `${input.encodingLabel} finished on ${input.backendName ?? "the routed backend"}.`;
  if (input.phase === "failed") return input.error ?? "Encoding or routing did not complete.";
  if (input.pending) return "No backend yet. Expand to see what the encoder will do once the router picks one.";
  return `${input.encodingLabel} will run on ${input.backendName ?? "the routed backend"}.`;
}

export function buildEncodingPreview(input: EncodingPreviewInput): EncodingPreviewPlan {
  const phase = input.phase ?? (input.error ? "failed" : input.encoding ? "ready" : "quoting");
  const backendId = resolvePreviewBackendId(input);
  const backend = backendId ? getBackend(backendId) : undefined;
  const bundle = input.encoding?.selected_bundle;
  const traceApplies = Boolean(bundle && (!backendId || bundle.backend_id === backendId));
  const encoding = traceApplies ? input.encoding : undefined;
  const liveBundle = encoding?.selected_bundle;
  const profile = backend ? encoderProfile(backend) : PENDING;
  const mediaType = liveBundle?.media_type || profile.mediaType;
  const encodingLabel = backend ? labelFor(profile, mediaType) : profile.label;
  const modality = backend ? modalityOf(backend) : "simulator";
  const qubits = liveBundle?.metrics.qubits ?? encoding?.requirements.qubits ?? input.qubits;
  const depth = liveBundle?.metrics.depth ?? input.transpilation?.after.depth ?? input.depth;
  const gates = gateCount(liveBundle?.metrics) ?? input.transpilation?.after.gates ?? input.gates;
  const twoQubit = liveBundle?.metrics.two_qubit_ops;
  const shots = input.shots;
  const payloadBytes = liveBundle?.payload_bytes;
  const change = compileChange(
    input.transpilation?.before,
    input.transpilation?.after ?? (liveBundle
      ? { depth: liveBundle.metrics.depth, gates: gateCount(liveBundle.metrics) ?? liveBundle.metrics.two_qubit_ops }
      : null),
  );
  const warnings: string[] = [];
  if (input.error) warnings.push(input.error);
  if (input.updating) warnings.push("Compile metrics and price refresh when quoting finishes. The plan already reflects the parameters you just changed.");
  if (input.encoding && !traceApplies && backend) {
    warnings.push(`The last quote encoded for a different backend. Showing the ${encodingLabel} plan for ${backend.displayName}.`);
  }
  if (!input.encoding && !backend && !input.error && phase !== "quoting") {
    warnings.push("This job does not have an encoding trace yet — older runs stored only the route.");
  }
  if (backend && qubits != null && qubits > backend.qubits) {
    warnings.push(`${qubits} qubits exceed ${backend.displayName} (${backend.qubits} qubits). The encoder will refuse this target.`);
  }
  if (backend && input.kind && backend.kind !== input.kind) {
    warnings.push(`Compute type is pinned to ${input.kind}, but ${backend.displayName} is a ${backend.kind}.`);
  }
  if (modality === "photonic" && qubits != null) {
    warnings.push(`Dual-rail mapping uses ${qubits * 2} optical modes for ${qubits} logical qubits.`);
  }
  if (shots != null && shots > 100_000) {
    warnings.push(`${shots.toLocaleString()} shots is a large sample. Cost and result size scale linearly.`);
  }
  if (modality === "simulator" && qubits != null && qubits >= 20) {
    warnings.push("State-vector simulation grows as 2ⁿ. Depth and wall-clock can jump on large jobs.");
  }
  if (encoding?.requirements.mid_circuit_measurement || encoding?.requirements.feedback) {
    warnings.push("This program uses mid-circuit measurement or feedback. Most QPUs will be scored incompatible.");
  }
  if (encoding?.requirements.control_flow.length) {
    warnings.push(`Control flow (${encoding.requirements.control_flow.join(", ")}) is gated by backend capability.`);
  }
  warnings.push(...profile.extraWarnings);
  if (liveBundle?.verification === "failed") warnings.push("Verification failed on this bundle. The router should fail over rather than submit it.");
  if (liveBundle?.verification === "unsupported" || liveBundle?.verification === "partial") {
    warnings.push(`Verification is ${verificationLabel(liveBundle.verification).toLowerCase()} — not a proof the operators match.`);
  }

  const resources: EncodingPreviewResource[] = [
    { key: "qubits", label: "Qubits", value: qubits != null ? String(qubits) : "—" },
    { key: "depth", label: "Depth", value: change?.depth ? `${change.depth.from} → ${change.depth.to}` : depth != null ? String(depth) : "—" },
    { key: "shots", label: "Shots", value: shots != null ? shots.toLocaleString() : "—" },
    { key: "payload", label: "Payload", value: payloadBytes != null ? formatPayloadBytes(payloadBytes) : input.sourceBytes != null ? `source ${formatPayloadBytes(input.sourceBytes)}` : "—" },
  ];
  if (modality === "photonic" && qubits != null) {
    resources.push({ key: "modes", label: "Modes", value: String(qubits * 2) });
  }
  if (twoQubit != null) resources.push({ key: "twoq", label: "Two-qubit", value: String(twoQubit) });
  if (gates != null && !change?.gates) resources.push({ key: "gates", label: "Gates", value: String(gates) });
  if (change?.gates) resources.push({ key: "gates", label: "Gates", value: `${change.gates.from} → ${change.gates.to}` });

  const inputFormat = input.format === "openqasm3" ? "OpenQASM 3" : input.format === "openqasm2" ? "OpenQASM 2" : "OpenQASM";
  const parameters: EncodingPreviewParameter[] = [
    {
      name: "Backend",
      value: backend?.displayName ?? (input.targetId === "auto" || !input.targetId ? "Automatic" : backendId ?? "—"),
      effect: backend
        ? `Selects the ${encodingLabel} encoder (${MODALITY_LABEL[modality]}).`
        : input.kind
          ? `The router picks a compatible ${computeTypeLabel(input.kind).toLowerCase()}; the encoder is whatever that machine requires.`
          : "The router picks a compatible machine; the encoder is whatever that machine requires.",
    },
    {
      name: "Encoding",
      value: encodingLabel,
      effect: profile.why,
    },
    {
      name: "Modality",
      value: MODALITY_LABEL[modality],
      effect: modality === "photonic"
        ? "Gate-model source is dual-rail encoded. Modes, not just qubits, set the payload."
        : modality === "simulator"
          ? "Ideal gates. Compiled depth is the runtime depth; there is no decoherence model in the encoder."
          : "Hardware ISA and connectivity constrain the transpile. Source depth is not the depth that runs.",
    },
    {
      name: "Qubits",
      value: qubits != null ? String(qubits) : "from the circuit",
      effect: backend && qubits != null
        ? (qubits > backend.qubits
          ? `Over capacity (${backend.qubits} on ${backend.displayName}).`
          : modality === "photonic"
            ? `${qubits} logical qubits → ${qubits * 2} modes.`
            : `${backend.displayName} has ${backend.qubits} qubits; this job uses ${qubits}.`)
        : "Register width is measured at analyze time.",
    },
    {
      name: "Shots",
      value: shots != null ? shots.toLocaleString() : "—",
      effect: shots != null
        ? `Each shot is one execution of the encoded program. Sample size and provider cost scale with ${shots.toLocaleString()}.`
        : "Shot count is applied at execution, not during lowering.",
    },
    {
      name: "Input format",
      value: inputFormat,
      effect: "Parsed into the encoding envelope, then lowered per target — the pasted dialect is not what the provider runs.",
    },
    {
      name: "Routing",
      value: input.routingMode ?? "balanced",
      effect: routingEffect(input.routingMode),
    },
    {
      name: "Compute type",
      value: computeTypeLabel(input.kind),
      effect: input.kind
        ? (backend && backend.kind !== input.kind
          ? `${backend.displayName} is a ${backend.kind}, which conflicts with this pin.`
          : `Only ${input.kind === "qpu" ? "physical QPUs" : "simulators"} stay eligible.`)
        : "No kind pin. Simulators and QPUs are both scored.",
    },
  ];
  if (liveBundle?.quote_binding) {
    parameters.push({
      name: "Quote",
      value: quoteBindingLabel(liveBundle.quote_binding),
      effect: liveBundle.quote_binding === "binding" ? "Price is locked for this compiled bundle." : "Indicative — a failover candidate, not the primary.",
    });
  }

  const mappings: EncodingPreviewMapping[] = [];
  if (encoding) {
    mappings.push({ label: "Workload", detail: workloadLabel(encoding.workload_kind) });
    mappings.push({
      label: "Operations",
      detail: encoding.requirements.instructions.slice(0, 10).join(", ") || "—",
    });
  }
  if (liveBundle) {
    mappings.push({ label: "Bit order", detail: bitOrderLabel(liveBundle.bit_order) });
    const layout = liveBundle.decode_map.layout;
    const mapped = layout ? Object.keys(layout.logical_to_physical).length : 0;
    mappings.push({
      label: "Layout",
      detail: layout ? `Mapped ${mapped} logical qubits onto the chip` : "Identity / all-to-all — no extra SWAP routing recorded",
    });
    mappings.push({
      label: "Measurements",
      detail: liveBundle.decode_map.measurement_map.length
        ? `${liveBundle.decode_map.measurement_map.length} qubit → bit pairs`
        : "No measurement map on the bundle",
    });
    mappings.push({ label: "Verification", detail: verificationLabel(liveBundle.verification) });
  } else if (backend) {
    mappings.push({ label: "Bit order", detail: profile.family === "ionq-qis" ? bitOrderLabel("q0_left") : bitOrderLabel("q0_right") });
    mappings.push({
      label: "Native gates",
      detail: backend.nativeGates.slice(0, 12).join(", ") + (backend.nativeGates.length > 12 ? "…" : ""),
    });
  }
  if (input.candidates?.length || input.explanation?.length) {
    mappings.push({
      label: "Route",
      detail: whyRouted({ selectedId: backendId, selectedName: backend?.displayName, candidates: input.candidates, explanation: input.explanation }),
    });
  }

  const source: EncodingPreviewPlan["source"] = encoding ? "trace" : backend ? "catalog" : "pending";

  return {
    encodingId: profile.family,
    encodingLabel,
    headline: headlineFor({
      phase,
      updating: input.updating,
      error: input.error,
      encodingLabel,
      backendName: backend?.displayName,
      pending: !backend,
    }),
    why: profile.why,
    transform: change?.text ? `${profile.transform} Compiled circuit: ${change.text}.` : profile.transform,
    nextStep: nextStepFor(phase, profile, input.jobStatus),
    modality,
    modalityLabel: MODALITY_LABEL[modality],
    backendId,
    backendName: backend?.displayName,
    mediaType,
    formatLabel: formatMediaType(mediaType),
    shots,
    resources,
    parameters,
    mappings,
    warnings: [...new Set(warnings.filter(Boolean))],
    source,
    error: input.error,
    phase,
  };
}
