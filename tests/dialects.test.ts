import { describe, expect, it, vi } from "vitest";
import QuantumCircuit from "quantum-circuit";
import { POST as createJob } from "@/app/api/v1/jobs/route";
import { analyzeCircuit, CircuitValidationError } from "@/lib/qrouter/analyze";
import { DialectError, evaluateParam, expandDialects } from "@/lib/qrouter/dialects";
import { qasm2ToIonqCircuit } from "@/lib/qrouter/execution";
import { simulateCircuit } from "@/lib/qrouter/simulator";
import { transpileForBackend } from "@/lib/qrouter/transpiler";
import { BACKENDS } from "@/lib/qrouter/catalog";

const HEADER = 'OPENQASM 2.0;\ninclude "qelib1.inc";\n';

/** Runs a circuit through quantum-circuit and returns the state vector. */
function stateVector(qasm: string) {
  const circuit = new QuantumCircuit();
  let errors: unknown[] = [];
  circuit.importQASM(qasm.replace(/;/g, ";\n"), (value: unknown) => {
    if (Array.isArray(value)) errors = value;
    else if (value) errors = [value];
  }, false);
  expect(errors).toEqual([]);
  circuit.run();
  const qubits = (circuit as unknown as { numQubits: number }).numQubits;
  const state = (circuit as unknown as { state: Record<number, { re?: number; im?: number }> }).state;
  return Array.from({ length: 2 ** qubits }, (_, index) => ({
    re: state[index]?.re ?? 0,
    im: state[index]?.im ?? 0,
  }));
}

/** |<a|b>| — 1.0 means identical up to global phase. */
function fidelity(a: Array<{ re: number; im: number }>, b: Array<{ re: number; im: number }>) {
  let re = 0;
  let im = 0;
  for (let index = 0; index < a.length; index += 1) {
    re += a[index].re * b[index].re + a[index].im * b[index].im;
    im += a[index].re * b[index].im - a[index].im * b[index].re;
  }
  return Math.hypot(re, im);
}

function expectEquivalent(dialectBody: string, referenceBody: string, registers = "qreg q[2];\n") {
  const prep = "ry(0.7) q[0]; rz(0.3) q[0]; ry(1.1) q[1]; rz(-0.4) q[1]; cx q[0],q[1];\n";
  const expanded = expandDialects(HEADER + registers + prep + dialectBody);
  const reference = HEADER + registers + prep + referenceBody;
  expect(fidelity(stateVector(expanded), stateVector(reference))).toBeGreaterThan(0.99999);
}

describe("dialect expansion", () => {
  it("evaluates parameter expressions", () => {
    expect(evaluateParam("pi/2")).toBeCloseTo(Math.PI / 2, 12);
    expect(evaluateParam("-2*pi*0.25")).toBeCloseTo(-Math.PI / 2, 12);
    expect(evaluateParam("0.5e1")).toBeCloseTo(5, 12);
    expect(() => evaluateParam("phi")).toThrow(DialectError);
  });

  it("expands IBM-native ecr to a verified core decomposition", () => {
    const q = Math.PI / 4;
    const rzx = (theta: number) => `h q[1]; cx q[0],q[1]; rz(${theta}) q[1]; cx q[0],q[1]; h q[1];`;
    expectEquivalent("ecr q[0],q[1];", `${rzx(q)} x q[0]; ${rzx(-q)}`);
  });

  it("expands IQM-native prx", () => {
    expectEquivalent("prx(0.9,0.5) q[0];", "rz(-0.5) q[0]; rx(0.9) q[0]; rz(0.5) q[0];");
  });

  it("expands IonQ-native gpi/gpi2/ms using the turns convention", () => {
    const lambda = 2 * Math.PI * 0.15;
    expectEquivalent(`gpi(0.15) q[0];`, `rz(${-lambda}) q[0]; x q[0]; rz(${lambda}) q[0];`);
    const l2 = 2 * Math.PI * 0.2;
    expectEquivalent(`gpi2(0.2) q[0];`, `rz(${-l2}) q[0]; rx(${Math.PI / 2}) q[0]; rz(${l2}) q[0];`);
  });

  it("expands Rigetti-dialect cphase and xy", () => {
    const t = 0.8;
    expectEquivalent(
      `cphase(${t}) q[0],q[1];`,
      `rz(${t / 2}) q[0]; cx q[0],q[1]; rz(${-t / 2}) q[1]; cx q[0],q[1]; rz(${t / 2}) q[1];`,
    );
    // xy(t) = rxx(-t/2) . ryy(-t/2); compare against explicit reference sequences
    const half = -0.45;
    const rxx = `h q[0]; h q[1]; cx q[0],q[1]; rz(${half}) q[1]; cx q[0],q[1]; h q[0]; h q[1];`;
    const hp = Math.PI / 2;
    const ryy = `rx(${hp}) q[0]; rx(${hp}) q[1]; cx q[0],q[1]; rz(${half}) q[1]; cx q[0],q[1]; rx(${-hp}) q[0]; rx(${-hp}) q[1];`;
    expectEquivalent("xy(0.9) q[0],q[1];", `${rxx} ${ryy}`);
  });

  it("keeps core gates and register names untouched", () => {
    const source = `${HEADER}qreg qr[2];\ncreg cr[2];\nh qr[0];\ncx qr[0],qr[1];\nmeasure qr -> cr;`;
    const expanded = expandDialects(source);
    expect(expanded).toContain("h qr[0];");
    expect(expanded).toContain("measure qr -> cr;");
  });

  it("rejects unknown gates instead of silently dropping them", () => {
    expect(() => expandDialects(`${HEADER}qreg q[1];\nfoo q[0];`)).toThrow(DialectError);
  });
});

describe("analyzeCircuit with provider dialects", () => {
  it("accepts an IBM-native circuit (ecr/sx/rz) end to end", () => {
    const source = `${HEADER}qreg q[2];\ncreg c[2];\nsx q[0];\nrz(pi/4) q[0];\necr q[0],q[1];\nmeasure q -> c;`;
    const analysis = analyzeCircuit(source, "openqasm2");
    expect(analysis.qubits).toBe(2);
    expect(analysis.gates).toBeGreaterThan(0);
    expect(analysis.measurements).toBe(2);
    // and it simulates without corruption
    const result = simulateCircuit(analysis, 256);
    expect(result.shots).toBe(256);
  });

  it("rejects unknown gates instead of pricing an empty circuit", () => {
    const source = `${HEADER}qreg q[2];\ncreg c[2];\nh q[0];\nmystery q[0],q[1];\nmeasure q -> c;`;
    expect(() => analyzeCircuit(source, "openqasm2")).toThrow(CircuitValidationError);
  });
});

describe("local transpilation preserves circuits", () => {
  const aer = BACKENDS.find((backend) => backend.id === "qci-aer-gpu")!;

  it("does not delete gates outside the local optimizer set", async () => {
    const source = `${HEADER}qreg q[2];\ncreg c[2];\nh q[0];\ncz q[0],q[1];\nsdg q[0];\nmeasure q -> c;`;
    const analysis = analyzeCircuit(source, "openqasm2");
    const result = await transpileForBackend(aer, analysis, { optimizationLevel: 2 });
    expect(result.after.gates).toBe(analysis.gates);
    expect(result.qasm).toContain("cz");
    expect(result.qasm).toContain("sdg");
  });

  it("falls back to local compilation when the remote compiler is unreachable", async () => {
    process.env.QROUTER_COMPILER_URL = "https://compiler.invalid";
    try {
      const analysis = analyzeCircuit(`${HEADER}qreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\nmeasure q -> c;`, "openqasm2");
      const fetchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
      vi.stubGlobal("fetch", fetchMock);
      const result = await transpileForBackend(aer, analysis, { optimizationLevel: 2 });
      expect(result.compiler).toBe("local");
      expect(result.verificationNote).toContain("Compiler service unreachable");
      expect(result.qasm).toContain("OPENQASM 2.0");
    } finally {
      vi.unstubAllGlobals();
      delete process.env.QROUTER_COMPILER_URL;
    }
  });

  it("still refuses QPU compilation when the remote compiler is unreachable", async () => {
    process.env.QROUTER_COMPILER_URL = "https://compiler.invalid";
    try {
      const qpu = BACKENDS.find((backend) => backend.id === "ionq-aria-1")!;
      const analysis = analyzeCircuit(`${HEADER}qreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\nmeasure q -> c;`, "openqasm2");
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")));
      await expect(transpileForBackend(qpu, analysis, { optimizationLevel: 2 })).rejects.toThrow(/fetch failed/);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.QROUTER_COMPILER_URL;
    }
  });

  it("preserves a partial measurement map through optimization", async () => {
    const source = `${HEADER}qreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\nmeasure q[1] -> c[1];`;
    const analysis = analyzeCircuit(source, "openqasm2");
    const result = await transpileForBackend(aer, analysis, { optimizationLevel: 2 });
    expect(result.qasm).toContain("measure q[1] -> c[1];");
    expect(result.qasm).not.toContain("measure q[0]");
  });
});

describe("cross-provider formatting through the jobs API", () => {
  function jobRequest(circuit: string) {
    return new Request("http://localhost/api/v1/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer qci_test_local_development" },
      body: JSON.stringify({ circuit, shots: 512, target: "qci-aer-gpu", routing_mode: "balanced" }),
    });
  }

  it("runs an IBM-native (ecr/sx/rz) circuit end to end on QCI Aer", async () => {
    const circuit = `${HEADER}qreg q[2];\ncreg c[2];\nsx q[0];\nrz(pi/2) q[0];\necr q[0],q[1];\nmeasure q -> c;`;
    const response = await createJob(jobRequest(circuit));
    const job = await response.json();
    expect(response.status).toBe(201);
    expect(job.status).toBe("completed");
    const counts = job.result.counts as Record<string, number>;
    expect(Object.values(counts).reduce((sum, value) => sum + value, 0)).toBe(512);
  });

  it("runs a Rigetti-dialect (cphase/iswap/xy) circuit end to end on QCI Aer", async () => {
    const circuit = `${HEADER}qreg q[2];\ncreg c[2];\nh q[0];\ncphase(pi/4) q[0],q[1];\niswap q[0],q[1];\nxy(pi/2) q[0],q[1];\nmeasure q -> c;`;
    const response = await createJob(jobRequest(circuit));
    const job = await response.json();
    expect(response.status).toBe(201);
    expect(job.status).toBe("completed");
  });

  it("runs an IonQ-native (gpi/gpi2/ms) circuit end to end on QCI Aer", async () => {
    const circuit = `${HEADER}qreg q[2];\ncreg c[2];\ngpi2(0.25) q[0];\nms(0,0,0.25) q[0],q[1];\ngpi(0.5) q[1];\nmeasure q -> c;`;
    const response = await createJob(jobRequest(circuit));
    const job = await response.json();
    expect(response.status).toBe(201);
    expect(job.status).toBe("completed");
  });
});

describe("IonQ program conversion", () => {
  it("translates the full core gate set faithfully", () => {
    const source = `${HEADER}qreg q[2];\ncreg c[2];\nh q[0];\nsdg q[0];\ntdg q[1];\nrz(pi/2) q[0];\ncz q[0],q[1];\nswap q[0],q[1];\ncx q[0],q[1];\nmeasure q -> c;`;
    const gates = qasm2ToIonqCircuit(source);
    const names = gates.map((gate) => gate.gate);
    expect(names).toContain("si");
    expect(names).toContain("ti");
    expect(names).toContain("swap");
    expect(names).toContain("cnot");
    // cz decomposes to h/cnot/h
    expect(names.filter((name) => name === "h").length).toBeGreaterThanOrEqual(3);
    const rz = gates.find((gate) => gate.gate === "rz") as { rotation: number };
    expect(rz.rotation).toBeCloseTo(Math.PI / 2, 12);
  });

  it("maps multi-register circuits onto flat wire indices", () => {
    const source = `${HEADER}qreg a[1];\nqreg b[2];\ncreg c[3];\nh a[0];\ncx a[0],b[1];`;
    const gates = qasm2ToIonqCircuit(source);
    expect(gates).toEqual([
      { gate: "h", target: 0 },
      { gate: "cnot", control: 0, target: 2 },
    ]);
  });

  it("fails closed on gates it cannot express", () => {
    const source = `${HEADER}qreg q[2];\nunknown_gate q[0],q[1];`;
    expect(() => qasm2ToIonqCircuit(source)).toThrow(/not supported|could not parse/i);
  });
});
