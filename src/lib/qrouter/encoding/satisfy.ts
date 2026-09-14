/**
 * RequirementSet, CapabilityProfile, and satisfies() — §5.5–5.7.
 * A backend is a candidate only when its adapter-declared profile covers the
 * workload kind, OpIds (or a lowering path), connectivity, classical control,
 * timing, result types, and numeric limits.
 */

import type { Backend } from "../types";
import { couplingSatisfaction, twoQubitPairs } from "./coupling";
import { jcsHash } from "./jcs";
import { LOWERABLE } from "./lowering";
import { opIdsFromTokens, resolveOpId } from "./ops";
import { ADAPTER_VERSION, CAP_SCHEMA, REQ_SCHEMA } from "./types";
import type {
  CapabilityProfile,
  GateProgram,
  InstructionRequirement,
  RequirementSet,
  SatisfactionFailure,
  Verdict,
  Workload,
  WorkloadKind,
} from "./types";

const TTL_SECONDS = 300;
const CORE_OR_LOWERABLE = new Set<string>([
  ...LOWERABLE,
  "u1", "u2", "u3", "cx", "h", "x", "y", "z", "s", "sdg", "t", "tdg",
  "rx", "ry", "rz", "id", "swap", "cz", "ccx", "measure",
]);

function addInstruction(seen: Map<string, InstructionRequirement>, name: string, qubits: number, params: number) {
  const op = resolveOpId(name);
  const key = op?.key ?? `op:${name}`;
  if (!seen.has(key)) {
    seen.set(key, {
      opid: key,
      name,
      arity: op?.arity ?? { qubits, params },
    });
  }
}

function programOf(workload: Workload): GateProgram | null {
  if (workload.kind === "gate" || workload.kind === "dynamic" || workload.kind === "timed" || workload.kind === "estimation") {
    return workload.program;
  }
  return null;
}

export function deriveRequirements(workload: Workload): RequirementSet {
  const program = programOf(workload);
  const control_flow: RequirementSet["classical"]["control_flow"] = [];
  const seen = new Map<string, InstructionRequirement>();
  let mid = false;
  let feedback = false;
  let delays = false;
  let gates = 0;
  let twoQubitGates = 0;
  if (program) {
    let measured = false;
    const visit = (statements: typeof program.body, countMetrics: boolean) => {
      for (const statement of statements) {
        if (statement.op === "measure") {
          measured = true;
          addInstruction(seen, "measure", 1, 0);
          continue;
        }
        if (statement.op === "gate") {
          addInstruction(seen, statement.name, statement.qubits.length, statement.params.length);
          if (countMetrics) {
            gates += 1;
            if (statement.qubits.length > 1) twoQubitGates += 1;
          }
          if (measured) {
            mid = true;
            feedback = true;
          }
          continue;
        }
        if (statement.op === "delay") delays = true;
        if (statement.op === "if" || statement.op === "for" || statement.op === "while" || statement.op === "switch") {
          if (!control_flow.includes(statement.op)) control_flow.push(statement.op);
          if (statement.op === "if") {
            visit(statement.then, countMetrics);
            if (statement.else) visit(statement.else, countMetrics);
          } else if (statement.op === "for" || statement.op === "while") visit(statement.body, countMetrics);
          else for (const entry of statement.cases) visit(entry.body, countMetrics);
        }
      }
    };
    visit(program.body, true);
    for (const def of Object.values(program.gate_defs)) visit(def.body, false);
  }
  const qubits = program ? program.qubits.reduce((sum, register) => sum + register.size, 0) : 0;
  const classicalBits = program ? program.clbits.reduce((sum, register) => sum + register.size, 0) : 0;
  const pairs = program ? twoQubitPairs(program) : [];
  const shots = "shots" in workload ? workload.shots : "reads" in workload ? workload.reads : 0;
  return {
    schema_version: REQ_SCHEMA,
    workload_kind: workload.kind,
    qubits,
    clbits: classicalBits,
    instructions: [...seen.values()],
    connectivity: { pairs, needs_routing: pairs.length > 0 || twoQubitGates > 0 },
    classical: { mid_circuit_measurement: mid, feedback, control_flow },
    timing: { explicit_delays: delays, stretch: workload.kind === "timed", pulse_level: workload.kind === "timed" },
    results: workload.kind === "photonic" ? ["photon_pattern"] : workload.kind === "annealing" ? ["annealing"] : ["counts", "probabilities"],
    limits: { shots, depth: gates, ops: gates, batch_size: 1 },
  };
}

const GATE_KINDS: WorkloadKind[] = ["gate"];

export function staticProfile(backend: Backend, adapterName: string, extra?: Partial<CapabilityProfile>): CapabilityProfile {
  const photonic = backend.provider === "xanadu" || backend.provider === "quandela" || Boolean(backend.capabilityNote?.includes("photonic"));
  const kinds: WorkloadKind[] = extra?.workload_kinds ?? (photonic ? ["photonic"] : GATE_KINDS);
  const tokens = [...new Set([...backend.basisGates, ...backend.nativeGates])];
  const now = new Date().toISOString();
  const gateCapable = kinds.includes("gate");
  const extraFields = extra ?? {};
  const overrides = { ...extraFields };
  delete overrides.schema_version;
  delete overrides.backend_id;
  delete overrides.adapter;
  delete overrides.fingerprint;
  const base: Omit<CapabilityProfile, "fingerprint"> = {
    schema_version: CAP_SCHEMA,
    backend_id: backend.id,
    adapter: { name: adapterName, version: ADAPTER_VERSION },
    source: "static_fallback",
    fetched_at: now,
    staleness: { ttl_seconds: TTL_SECONDS, is_stale: false },
    workload_kinds: kinds,
    instructions: extra?.instructions ?? (gateCapable ? opIdsFromTokens(tokens) : []),
    connectivity: backend.connectivity === "all-to-all"
      ? { kind: "all-to-all" }
      : { kind: "coupling_map", coupling_map: (backend.couplingMap ?? []) as [number, number][] },
    classical: { mid_circuit_measurement: false, feedback: false, control_flow: [] },
    timing: { explicit_delays: false, stretch: false, pulse_level: false },
    result_types: extra?.result_types ?? (photonic
      ? (gateCapable ? ["counts", "probabilities", "photon_pattern"] : ["photon_pattern"])
      : ["counts", "probabilities"]),
    limits: { max_qubits: backend.qubits, max_shots: 1_000_000 },
    calibration: null,
    provider_schema_version: "static/1",
    routable: extra?.routable ?? backend.available,
    routing_note: extra?.routing_note ?? backend.capabilityNote,
    ...overrides,
  };
  // fetched_at is telemetry, not capability. Hashing it made every profile
  // unique and the compile cache unreachable across quote → confirm.
  return { ...base, fingerprint: jcsHash({ ...base, fetched_at: undefined, fingerprint: undefined }) };
}

function canLowerTo(opid: string, cap: CapabilityProfile, supported: Set<string>): boolean {
  if (supported.has(opid)) return true;
  const name = opid.replace(/^op:/, "");
  if (!CORE_OR_LOWERABLE.has(name)) return false;
  // A lowerable (or core) gate can run on any gate-model adapter that implements encode.
  return cap.workload_kinds.includes("gate") && cap.instructions.length > 0;
}

export function satisfies(req: RequirementSet, cap: CapabilityProfile): Verdict {
  const failures: SatisfactionFailure[] = [];
  const supported = new Set(cap.instructions.map((item) => item.opid));
  if (!cap.workload_kinds.includes(req.workload_kind)) {
    failures.push({
      code: "workload_kind",
      message: `${cap.backend_id} accepts ${cap.workload_kinds.join(", ") || "no advertised"} workloads, not ${req.workload_kind}`,
      requirement: req.workload_kind,
    });
  }
  if (req.qubits > cap.limits.max_qubits) {
    failures.push({
      code: "insufficient_qubits",
      message: `requires ${req.qubits} qubits; backend has ${cap.limits.max_qubits}`,
    });
  }
  if (req.limits.shots > cap.limits.max_shots) {
    failures.push({ code: "shot_limit", message: `shots ${req.limits.shots} exceed backend max ${cap.limits.max_shots}` });
  }
  for (const instruction of req.instructions) {
    if (instruction.opid === "op:barrier" || instruction.opid === "op:reset") continue;
    if (!canLowerTo(instruction.opid, cap, supported)) {
      failures.push({
        code: "instruction",
        message: `${cap.backend_id} cannot encode ${instruction.name} (${instruction.opid})`,
        requirement: instruction.opid,
      });
    }
  }
  if (req.classical.feedback && !cap.classical.feedback) {
    failures.push({ code: "feedback", message: "backend does not support mid-circuit measurement with feedback" });
  }
  if (req.classical.mid_circuit_measurement && !cap.classical.mid_circuit_measurement && !cap.classical.feedback) {
    failures.push({ code: "mid_circuit", message: "backend does not support mid-circuit measurement" });
  }
  for (const flow of req.classical.control_flow) {
    if (!cap.classical.control_flow.includes(flow)) {
      failures.push({ code: "control_flow", message: `backend does not support ${flow}` });
    }
  }
  if (req.timing.pulse_level && !cap.timing.pulse_level) {
    failures.push({ code: "timing", message: "backend does not support pulse-level / timed programs" });
  }
  for (const result of req.results) {
    if (!cap.result_types.includes(result) && result !== "counts" && result !== "probabilities") {
      failures.push({ code: "result_type", message: `backend cannot return ${result}` });
    }
  }
  const notes: string[] = [];
  if (cap.connectivity.kind === "all-to-all") {
    notes.push(`${cap.backend_id} is all-to-all; no coupling routing is required`);
  } else {
    const map = cap.connectivity.coupling_map;
    if (!map?.length) {
      notes.push("No coupling map published; the compiler will route two-qubit gates");
    } else if (req.connectivity.pairs.length) {
      const coupling = couplingSatisfaction(req.connectivity.pairs, map);
      if (!coupling.ok) {
        failures.push({ code: "connectivity", message: coupling.message });
      } else if (coupling.needsRouting) {
        notes.push(`SWAP routing required (~${coupling.hops} hops on the coupling map)`);
      } else {
        notes.push("all two-qubit pairs are adjacent on the coupling map");
      }
    }
  }
  if (failures.length) return { ok: false, failures };
  return { ok: true, notes: [`${cap.backend_id} satisfies ${req.workload_kind} requirements`, ...notes] };
}
