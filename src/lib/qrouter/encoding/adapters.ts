/**
 * Provider adapters (§5.8, Phase 4). Capability profiles are produced here
 * (principle 4). Photonic backends advertise gate + photonic kinds: gate-model
 * OpenQASM is dual-rail encoded for the native-input bridge, never silently
 * dropped. Quantum Inspire encodes to cQASM 1.0.
 */

import { getBackend } from "../catalog";
import type { Backend, CircuitAnalysis, TranspilationResult } from "../types";
import { buildBundle, verificationFromTranspile } from "./bundle";
import { measurementMap, registerLayout } from "./frontend";
import { nativeProgramFor } from "./native";
import { opIdsFromTokens } from "./ops";
import { staticProfile } from "./satisfy";
import { satisfies } from "./satisfy";
import type {
  CapabilityProfile,
  DecodeMap,
  ExecutionBundle,
  ExecutionEnvelope,
  GateProgram,
  QuoteBinding,
  Verdict,
} from "./types";
import { EncodingError } from "./types";

export interface EncodingAdapter {
  name: string;
  handles(backend: Backend): boolean;
  profile(backend: Backend): CapabilityProfile;
  validate(env: ExecutionEnvelope, cap: CapabilityProfile): Verdict;
  encode(input: {
    envelope: ExecutionEnvelope;
    backend: Backend;
    analysis: CircuitAnalysis;
    transpilation: TranspilationResult | null;
    capability: CapabilityProfile;
    quoteBinding: QuoteBinding;
  }): ExecutionBundle;
}

function programOf(envelope: ExecutionEnvelope): GateProgram | null {
  const workload = envelope.workload;
  if (workload.kind === "gate" || workload.kind === "dynamic" || workload.kind === "timed") return workload.program;
  return null;
}

function decodeMapFor(program: GateProgram | null, bitOrder: DecodeMap["bit_order"], layout: DecodeMap["layout"]): DecodeMap {
  return {
    bit_order: bitOrder,
    registers: program ? registerLayout(program) : [],
    measurement_map: program ? measurementMap(program) : [],
    layout,
    result_types: ["counts", "probabilities"],
  };
}

function layoutFrom(transpilation: TranspilationResult | null): DecodeMap["layout"] {
  const layout = transpilation?.layout;
  if (!layout || typeof layout !== "object") return null;
  const logical = (layout as { logicalToPhysical?: Record<string, number> }).logicalToPhysical;
  const routing = (layout as { routingPermutation?: number[] }).routingPermutation;
  if (!logical) return null;
  return {
    logical_to_physical: Object.fromEntries(Object.entries(logical).map(([key, value]) => [Number(key), Number(value)])),
    routing_permutation: routing ?? [],
  };
}

function metricsFrom(transpilation: TranspilationResult | null, analysis: CircuitAnalysis): ExecutionBundle["metrics"] {
  const source = transpilation?.after;
  return {
    qubits: source?.qubits ?? analysis.qubits,
    depth: source?.depth ?? analysis.depth,
    ops: source?.operations ?? analysis.gateCounts,
    two_qubit_ops: source?.twoQubitGates ?? analysis.twoQubitGates,
  };
}

function compilerOf(transpilation: TranspilationResult | null) {
  return {
    name: transpilation?.compiler ?? "local",
    version: transpilation?.compiler ?? "local",
    optimization_level: transpilation?.optimizationLevel ?? 0,
    seed: transpilation?.seedTranspiler ?? 42,
  };
}

const aer: EncodingAdapter = {
  name: "qci-aer",
  handles: (backend) => backend.id === "qci-aer-gpu" || backend.provider === "qci",
  profile: (backend) => staticProfile(backend, "qci-aer", {
    routable: true,
    routing_note: undefined,
    result_types: ["counts", "probabilities"],
  }),
  validate: (env, cap) => satisfies(env.requirements, cap),
  encode: (input) => buildBundle({
    envelope: input.envelope,
    backendId: input.backend.id,
    payload: input.transpilation?.qasm ?? input.analysis.normalizedQasm2,
    mediaType: "text/qasm2",
    decodeMap: decodeMapFor(programOf(input.envelope), "q0_right", layoutFrom(input.transpilation)),
    capability: input.capability,
    compiler: compilerOf(input.transpilation),
    verification: verificationFromTranspile(input.transpilation, input.capability),
    metrics: metricsFrom(input.transpilation, input.analysis),
    quoteBinding: input.quoteBinding,
  }),
};

const ibm: EncodingAdapter = {
  name: "ibm-runtime",
  handles: (backend) => backend.provider === "ibm",
  profile: (backend) => staticProfile(backend, "ibm-runtime", { routable: true }),
  validate: (env, cap) => satisfies(env.requirements, cap),
  encode: (input) => {
    const qpy = input.transpilation?.providerProgram;
    const payload = qpy && typeof qpy === "object" && "data" in qpy
      ? JSON.stringify(qpy)
      : input.transpilation?.artifactQasm ?? input.transpilation?.qasm ?? input.analysis.normalizedQasm2;
    const mediaType = qpy && typeof qpy === "object" ? "application/qpy" : "text/qasm3";
    return buildBundle({
      envelope: input.envelope,
      backendId: input.backend.id,
      payload,
      mediaType,
      decodeMap: decodeMapFor(programOf(input.envelope), "q0_right", layoutFrom(input.transpilation)),
      capability: input.capability,
      compiler: compilerOf(input.transpilation),
      verification: verificationFromTranspile(input.transpilation, input.capability),
      metrics: metricsFrom(input.transpilation, input.analysis),
      quoteBinding: input.quoteBinding,
    });
  },
};

const ionq: EncodingAdapter = {
  name: "ionq-qis",
  handles: (backend) => backend.provider === "ionq",
  profile: (backend) => staticProfile(backend, "ionq-qis", { routable: true }),
  validate: (env, cap) => satisfies(env.requirements, cap),
  encode: (input) => {
    const program = programOf(input.envelope);
    const map = program ? measurementMap(program) : [];
    if (!map.length) throw new EncodingError("IonQ encoding refused: the measurement map is empty; a circuit is never submitted without its classical mapping.");
    const payload = JSON.stringify({
      qubits: input.analysis.qubits,
      gateset: "qis",
      qasm: input.transpilation?.qasm ?? input.analysis.normalizedQasm2,
      measurement_map: map,
      registers: program ? registerLayout(program) : [],
    });
    return buildBundle({
      envelope: input.envelope,
      backendId: input.backend.id,
      payload,
      mediaType: "application/json",
      decodeMap: decodeMapFor(program, "q0_left", layoutFrom(input.transpilation)),
      capability: input.capability,
      compiler: compilerOf(input.transpilation),
      verification: verificationFromTranspile(input.transpilation, input.capability),
      metrics: metricsFrom(input.transpilation, input.analysis),
      quoteBinding: input.quoteBinding,
    });
  },
};

const braket: EncodingAdapter = {
  name: "aws-braket",
  handles: (backend) => backend.provider === "aws-braket",
  profile: (backend) => staticProfile(backend, "aws-braket", { routable: true }),
  validate: (env, cap) => satisfies(env.requirements, cap),
  encode: (input) => buildBundle({
    envelope: input.envelope,
    backendId: input.backend.id,
    payload: input.transpilation?.artifactQasm ?? input.transpilation?.qasm ?? input.analysis.normalizedQasm2,
    mediaType: "text/qasm3",
    decodeMap: decodeMapFor(programOf(input.envelope), "q0_right", layoutFrom(input.transpilation)),
    capability: input.capability,
    compiler: compilerOf(input.transpilation),
    verification: verificationFromTranspile(input.transpilation, input.capability),
    metrics: metricsFrom(input.transpilation, input.analysis),
    quoteBinding: input.quoteBinding,
  }),
};

const photonic: EncodingAdapter = {
  name: "photonic",
  handles: (backend) => backend.provider === "xanadu" || backend.provider === "quandela",
  profile: (backend) => staticProfile(backend, "photonic", {
    // Gate-model OpenQASM is dual-rail encoded for the contracted native-input
    // bridge. That is not a silent Qiskit-style translation — the payload is an
    // explicit photonic program, and unsupported gates fail closed.
    workload_kinds: ["gate", "photonic"],
    instructions: opIdsFromTokens(backend.basisGates),
    result_types: ["counts", "probabilities", "photon_pattern"],
    routing_note: "gate-model circuits are encoded to a dual-rail native-input IR for the photonic execution bridge",
  }),
  validate: (env, cap) => satisfies(env.requirements, cap),
  encode: (input) => {
    const qasm = input.transpilation?.qasm ?? input.analysis.normalizedQasm2;
    return buildBundle({
      envelope: input.envelope,
      backendId: input.backend.id,
      payload: JSON.stringify(nativeProgramFor(input.backend, qasm)),
      mediaType: "application/json",
      decodeMap: decodeMapFor(programOf(input.envelope), "q0_right", layoutFrom(input.transpilation)),
      capability: input.capability,
      compiler: compilerOf(input.transpilation),
      verification: verificationFromTranspile(input.transpilation, input.capability),
      metrics: metricsFrom(input.transpilation, input.analysis),
      quoteBinding: input.quoteBinding,
    });
  },
};

const quantumInspire: EncodingAdapter = {
  name: "quantum-inspire",
  handles: (backend) => backend.provider === "quantum-inspire",
  profile: (backend) => staticProfile(backend, "quantum-inspire", {
    routing_note: process.env.QI_API_KEY ? undefined : "Quantum Inspire execution requires QI_API_KEY (optional QI_EXECUTION_URL bridge).",
  }),
  validate: (env, cap) => satisfies(env.requirements, cap),
  encode: (input) => {
    const qasm = input.transpilation?.qasm ?? input.analysis.normalizedQasm2;
    const program = nativeProgramFor(input.backend, qasm);
    return buildBundle({
      envelope: input.envelope,
      backendId: input.backend.id,
      payload: program.format === "cqasm-1.0" ? program.source : JSON.stringify(program),
      mediaType: "text/cqasm",
      decodeMap: decodeMapFor(programOf(input.envelope), "q0_right", layoutFrom(input.transpilation)),
      capability: input.capability,
      compiler: compilerOf(input.transpilation),
      verification: verificationFromTranspile(input.transpilation, input.capability),
      metrics: metricsFrom(input.transpilation, input.analysis),
      quoteBinding: input.quoteBinding,
    });
  },
};

const ADAPTERS: EncodingAdapter[] = [aer, ibm, ionq, braket, photonic, quantumInspire];

export function adapterFor(backend: Backend): EncodingAdapter {
  const adapter = ADAPTERS.find((item) => item.handles(backend));
  if (!adapter) throw new EncodingError(`No encoding adapter for backend ${backend.id}.`);
  return adapter;
}

export function profileBackend(backend: Backend): CapabilityProfile {
  return adapterFor(backend).profile(backend);
}

export function encodeForBackend(input: {
  envelope: ExecutionEnvelope;
  backend: Backend;
  analysis: CircuitAnalysis;
  transpilation: TranspilationResult | null;
  quoteBinding: QuoteBinding;
}): ExecutionBundle {
  const adapter = adapterFor(input.backend);
  const capability = adapter.profile(input.backend);
  const verdict = adapter.validate(input.envelope, capability);
  if (!verdict.ok) {
    throw new EncodingError(
      `Encoder refused ${input.backend.id}: ${verdict.failures.map((failure) => failure.message).join("; ")}`,
      verdict.failures.map((failure) => failure.message),
    );
  }
  return adapter.encode({ ...input, capability });
}

export function advertisedCapabilities(backend: Backend) {
  const profile = profileBackend(backend);
  const catalog = getBackend(backend.id);
  return {
    input_formats: profile.workload_kinds.includes("gate") ? ["openqasm2", "openqasm3"] : [],
    execution: profile.routable ? "async" : "unavailable",
    result: profile.result_types,
    workload_kinds: profile.workload_kinds,
    source: profile.source,
    fingerprint: profile.fingerprint,
    adapter: profile.adapter,
    instructions: profile.instructions.map((item) => item.provider_token),
    routing: {
      encoder: profile.routable ? "implemented" : "unavailable",
      note: profile.routing_note ?? catalog?.capabilityNote,
    },
  };
}
