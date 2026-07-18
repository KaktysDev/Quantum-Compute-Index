import type { QpuComponent } from "@/lib/qci/types";
import type { Backend } from "./types";

const same = (gates: string[]) => gates;

export const BACKENDS: Backend[] = [
  {
    id: "qci-aer-gpu", provider: "qci", displayName: "QCI Aer GPU", kind: "simulator",
    status: "online", qubits: 30, nativeGates: same(["id", "x", "y", "z", "h", "s", "sdg", "t", "tdg", "rx", "ry", "rz", "cx", "cz", "swap", "measure"]),
    basisGates: same(["id", "x", "y", "z", "h", "s", "sdg", "t", "tdg", "rx", "ry", "rz", "cx", "cz", "swap", "measure"]),
    connectivity: "all-to-all",
    queueSeconds: 2, fidelity: 1, reliability: 0.999, pricePerShot: 0.000001,
    pricePerTask: 0.002, description: "Low-latency state-vector simulation", region: "Chicago",
    available: true,
  },
  {
    id: "aws-sv1", provider: "aws-braket", displayName: "Amazon SV1", kind: "simulator",
    backendName: "sv1",
    status: "online", qubits: 34, nativeGates: same(["x", "y", "z", "h", "s", "t", "rx", "ry", "rz", "cx", "cz", "swap", "measure"]),
    basisGates: same(["x", "y", "z", "h", "s", "t", "rx", "ry", "rz", "cx", "cz", "swap", "measure"]),
    connectivity: "all-to-all",
    queueSeconds: 8, fidelity: 1, reliability: 0.995, pricePerShot: 0.000075,
    pricePerTask: 0, description: "Managed state-vector simulator", region: "us-east-1",
    available: Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.BRAKET_OUTPUT_BUCKET),
  },
  {
    id: "ibm-brisbane", provider: "ibm", displayName: "IBM Brisbane", kind: "qpu",
    backendName: "ibm_brisbane",
    status: "online", qubits: 127, nativeGates: same(["id", "rz", "sx", "x", "ecr", "measure"]),
    basisGates: same(["id", "rz", "sx", "x", "ecr", "measure"]),
    connectivity: "target",
    queueSeconds: 780, fidelity: 0.992, reliability: 0.975, pricePerShot: 0.00035,
    pricePerTask: 0.3, description: "127-qubit Eagle processor", region: "IBM Cloud",
    available: Boolean(process.env.IBM_QUANTUM_TOKEN),
  },
  {
    id: "ionq-aria-1", provider: "ionq", displayName: "IonQ Aria 1", kind: "qpu",
    backendName: "aria-1",
    status: "online", qubits: 25, nativeGates: same(["gpi", "gpi2", "ms", "measure"]),
    basisGates: same(["x", "y", "z", "h", "s", "si", "t", "ti", "v", "vi", "rx", "ry", "rz", "cnot", "measure"]),
    connectivity: "all-to-all",
    queueSeconds: 1200, fidelity: 0.996, reliability: 0.96, pricePerShot: 0.00022,
    pricePerTask: 0.3, description: "High-fidelity trapped-ion QPU", region: "us-east-1",
    available: Boolean(process.env.IONQ_API_KEY || (process.env.AWS_ACCESS_KEY_ID && process.env.BRAKET_OUTPUT_BUCKET)),
  },
  {
    id: "iqm-garnet", provider: "aws-braket", displayName: "IQM Garnet", kind: "qpu",
    backendName: "garnet",
    status: "online", qubits: 20, nativeGates: same(["prx", "cz", "measure"]),
    basisGates: same(["rx", "ry", "rz", "cz", "measure"]),
    connectivity: "target",
    queueSeconds: 480, fidelity: 0.994, reliability: 0.965, pricePerShot: 0.00145,
    pricePerTask: 0.3, description: "Superconducting resonator architecture", region: "eu-north-1",
    available: Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.BRAKET_OUTPUT_BUCKET),
  },
  {
    id: "xanadu-borealis", provider: "xanadu", displayName: "Xanadu Borealis", kind: "qpu",
    status: "degraded", qubits: 216, nativeGates: same(["squeezing", "displacement", "beamsplitter", "measure"]),
    basisGates: same(["squeezing", "displacement", "beamsplitter", "measure"]),
    connectivity: "custom",
    queueSeconds: 1800, fidelity: 0.94, reliability: 0.91, pricePerShot: 0.002,
    pricePerTask: 1, description: "Photonic quantum processor", available: false,
  },
  {
    id: "quandela-mosaiq", provider: "quandela", displayName: "Quandela MosaiQ", kind: "qpu",
    status: "degraded", qubits: 12, nativeGates: same(["phase", "beamsplitter", "measure"]),
    basisGates: same(["phase", "beamsplitter", "measure"]),
    connectivity: "custom",
    queueSeconds: 960, fidelity: 0.96, reliability: 0.93, pricePerShot: 0.0015,
    pricePerTask: 0.5, description: "Photonic cloud QPU", available: false,
  },
  {
    id: "qi-starmon-5", provider: "quantum-inspire", displayName: "Starmon-5", kind: "qpu",
    backendName: "starmon-5",
    status: "degraded", qubits: 5, nativeGates: same(["x", "y", "z", "h", "rx", "ry", "rz", "cz", "measure"]),
    basisGates: same(["x", "y", "z", "h", "rx", "ry", "rz", "cz", "measure"]),
    connectivity: "custom",
    queueSeconds: 300, fidelity: 0.97, reliability: 0.94, pricePerShot: 0.0005,
    pricePerTask: 0.1, description: "Five-qubit superconducting QPU", available: false,
  },
];

export function getBackend(id: string): Backend | undefined {
  return BACKENDS.find((backend) => backend.id === id);
}

const COMPONENT_MATCHERS: Record<string, (component: QpuComponent) => boolean> = {
  "ibm-brisbane": (component) => /ibm/i.test(component.provider) || /brisbane/i.test(component.qpu),
  "ionq-aria-1": (component) => /ionq/i.test(component.provider) || /aria/i.test(component.qpu),
  "iqm-garnet": (component) => /iqm/i.test(component.provider) || /garnet/i.test(component.qpu),
  "xanadu-borealis": (component) => /xanadu/i.test(component.provider) || /borealis/i.test(component.qpu),
  "quandela-mosaiq": (component) => /quandela/i.test(component.provider) || /mosaiq/i.test(component.qpu),
  "qi-starmon-5": (component) => /quantum inspire|starmon/i.test(`${component.provider} ${component.qpu}`),
};

export function withQciSnapshot(components: QpuComponent[] = []): Backend[] {
  return BACKENDS.map((backend) => {
    const component = components.find((item) => COMPONENT_MATCHERS[backend.id]?.(item));
    if (!component) return backend;
    return {
      ...backend,
      queueSeconds: component.queueSeconds ?? backend.queueSeconds,
      fidelity: component.fid2q || backend.fidelity,
      pricePerNqh: component.pricePerNqh,
      clops: component.clops,
      status: component.status === "stale" ? "degraded" : backend.status,
    };
  });
}
