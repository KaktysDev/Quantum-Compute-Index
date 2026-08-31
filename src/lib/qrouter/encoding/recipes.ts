/**
 * Application data-encoding recipes (§5.12, C3.6).
 *
 * Isolated module: DataSpec → GateProgram only. No routing, capabilities,
 * execution, or billing imports. The router never selects a recipe.
 */

import type { GateProgram, Stmt } from "./types";

export type RecipeMaturity = "stable" | "experimental" | "research";

export interface DataSpec {
  values: number[];
  qubits?: number;
}

export interface RecipeEstimate {
  qubits: number;
  depth: number;
  two_qubit_ops: number;
  ancillas: number;
  caveats: string[];
}

export interface EncodingRecipe {
  id: string;
  maturity: RecipeMaturity;
  estimate(input: DataSpec): RecipeEstimate;
  build(input: DataSpec): GateProgram;
}

function program(qubits: number, body: Stmt[]): GateProgram {
  return {
    qubits: [{ name: "q", size: qubits }],
    clbits: [{ name: "c", size: qubits }],
    params: [],
    body,
    gate_defs: {},
  };
}

function ry(theta: number, index: number): Stmt {
  return { op: "gate", name: "ry", params: [{ kind: "number", value: theta }], qubits: [{ register: "q", index }], modifiers: [] };
}

function x(index: number): Stmt {
  return { op: "gate", name: "x", params: [], qubits: [{ register: "q", index }], modifiers: [] };
}

export const basisV1: EncodingRecipe = {
  id: "basis/v1",
  maturity: "stable",
  estimate(input) {
    const qubits = input.values.length;
    return { qubits, depth: 1, two_qubit_ops: 0, ancillas: 0, caveats: ["One qubit per classical bit. Production-ready."] };
  },
  build(input) {
    const body = input.values.flatMap((value, index) => (value ? [x(index)] : []));
    return program(input.values.length, body);
  },
};

export const angleV1: EncodingRecipe = {
  id: "angle/v1",
  maturity: "stable",
  estimate(input) {
    return { qubits: input.values.length, depth: 1, two_qubit_ops: 0, ancillas: 0, caveats: ["One rotation per feature. Production-ready."] };
  },
  build(input) {
    return program(input.values.length, input.values.map((value, index) => ry(value, index)));
  },
};

export const amplitudeV1: EncodingRecipe = {
  id: "amplitude/v1",
  maturity: "experimental",
  estimate(input) {
    const qubits = Math.max(1, Math.ceil(Math.log2(Math.max(1, input.values.length))));
    return {
      qubits,
      depth: 2 ** qubits,
      two_qubit_ops: 2 ** qubits,
      ancillas: 0,
      caveats: ["Generic state preparation is exponential in qubit count. Cost must be accepted before quoting."],
    };
  },
  build(input) {
    const qubits = Math.max(1, Math.ceil(Math.log2(Math.max(1, input.values.length))));
    return program(qubits, input.values.slice(0, qubits).map((value, index) => ry(2 * Math.acos(Math.min(1, Math.max(-1, value))), index)));
  },
};

export const qramV1: EncodingRecipe = {
  id: "qram/v1",
  maturity: "research",
  estimate() {
    return { qubits: 0, depth: 0, two_qubit_ops: 0, ancillas: 0, caveats: ["Research only. Not selectable in production."] };
  },
  build() {
    throw new Error("qram/v1 is maturity: research and is not selectable in production.");
  },
};

export const RECIPES: EncodingRecipe[] = [basisV1, angleV1, amplitudeV1, qramV1];

export function getRecipe(id: string) {
  return RECIPES.find((recipe) => recipe.id === id);
}

export function productionRecipes() {
  return RECIPES.filter((recipe) => recipe.maturity === "stable");
}
