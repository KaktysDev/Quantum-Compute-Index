import QuantumCircuit from "quantum-circuit";
import { assertLocalSimulationLimit } from "./analyze";
import type { CircuitAnalysis } from "./types";

export interface SimulationResult {
  counts: Record<string, number>;
  probabilities: Record<string, number>;
  shots: number;
  backend: "qci-aer-gpu";
  executionMs: number;
  metadata: { engine: string; qubits: number; depth: number };
}

export function simulateCircuit(analysis: CircuitAnalysis, shots: number): SimulationResult {
  assertLocalSimulationLimit(analysis);
  const started = performance.now();
  const circuit = new QuantumCircuit();
  let errors: unknown[] = [];
  circuit.importQASM(analysis.normalizedQasm2, (value: unknown) => {
    if (Array.isArray(value)) errors = value;
    else if (value) errors = [value];
  }, false);
  if (errors.length) throw new Error(`Simulator transpilation failed: ${errors.map(String).join(", ")}`);
  circuit.run();
  const counts = circuit.measureAllMultishot(shots) as Record<string, number>;
  const probabilities = Object.fromEntries(Object.entries(counts).map(([state, count]) => [state, count / shots]));
  return {
    counts, probabilities, shots, backend: "qci-aer-gpu",
    executionMs: Math.round((performance.now() - started) * 100) / 100,
    metadata: { engine: "quantum-circuit state vector", qubits: analysis.qubits, depth: analysis.depth },
  };
}
