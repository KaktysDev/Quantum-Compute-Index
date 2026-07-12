import type { QpuComponent } from "@/lib/qci/types";
import type { Backend } from "./types";

const configured = (name: string) => Boolean(process.env[name]);

export const BACKENDS: Backend[] = [
  { id: "qci-aer-gpu", provider: "QCI", displayName: "QCI Aer GPU", kind: "simulator", status: "online", qubits: 30, clops: 1_000_000, queueSeconds: 2, fidelity: 1, reliability: .999, pricePerNqh: 3.6, taskMinimum: .002, description: "GPU state-vector simulator", region: "Chicago", available: true, backendName: "aer_simulator", basisGates: ["id","x","y","z","h","s","sdg","t","tdg","sx","rx","ry","rz","cx","cz","swap"], connectivity: "all-to-all" },
  { id: "aws-sv1", provider: "AWS Braket", displayName: "Amazon SV1", kind: "simulator", status: "online", qubits: 34, clops: 500_000, queueSeconds: 8, fidelity: 1, reliability: .995, pricePerNqh: 7.5, taskMinimum: .01, description: "Managed state-vector simulator", region: "us-east-1", available: configured("AWS_ACCESS_KEY_ID") && configured("BRAKET_OUTPUT_BUCKET"), backendName: "SV1", basisGates: ["x","y","z","h","s","sdg","t","tdg","sx","sxdg","rx","ry","rz","cx","cz","swap"], connectivity: "all-to-all" },
  { id: "ibm-brisbane", provider: "IBM", displayName: "IBM Brisbane", kind: "qpu", status: "online", qubits: 127, clops: 5_000, queueSeconds: 780, fidelity: .992, reliability: .975, pricePerNqh: 96, taskMinimum: .3, description: "127-qubit Eagle processor", available: configured("IBM_QUANTUM_TOKEN"), backendName: process.env.IBM_QUANTUM_BACKEND ?? "ibm_brisbane", basisGates: ["id","rz","sx","x","ecr"], connectivity: "target" },
  { id: "ionq-aria-1", provider: "IonQ", displayName: "IonQ Aria 1", kind: "qpu", status: "online", qubits: 25, clops: 500, queueSeconds: 1200, fidelity: .996, reliability: .96, pricePerNqh: 108, taskMinimum: .3, description: "Trapped-ion QPU", available: configured("IONQ_API_KEY") || (configured("AWS_ACCESS_KEY_ID") && configured("BRAKET_OUTPUT_BUCKET")), backendName: process.env.IONQ_BACKEND ?? "qpu.aria-1", basisGates: ["x","y","z","h","s","sdg","t","tdg","rx","ry","rz","cx","swap"], connectivity: "all-to-all" },
  { id: "iqm-garnet", provider: "IQM", displayName: "IQM Garnet", kind: "qpu", status: "online", qubits: 20, clops: 1_800, queueSeconds: 480, fidelity: .994, reliability: .965, pricePerNqh: 52.2, taskMinimum: .3, description: "Superconducting resonator QPU", available: configured("AWS_ACCESS_KEY_ID") && configured("BRAKET_OUTPUT_BUCKET"), backendName: "Garnet", basisGates: ["rx","ry","rz","cz"], connectivity: "target" },
  { id: "xanadu-borealis", provider: "Xanadu", displayName: "Xanadu Borealis", kind: "qpu", status: "degraded", qubits: 216, clops: 300, queueSeconds: 1800, fidelity: .94, reliability: .91, pricePerNqh: 120, taskMinimum: 1, description: "Photonic processor", available: configured("XANADU_EXECUTION_URL") && configured("XANADU_API_KEY"), backendName: "borealis", basisGates: ["rz","sx","x","cz"], connectivity: "target", executionModel: "photonic" },
  { id: "quandela-mosaiq", provider: "Quandela", displayName: "Quandela MosaiQ", kind: "qpu", status: "degraded", qubits: 12, clops: 400, queueSeconds: 960, fidelity: .96, reliability: .93, pricePerNqh: 85, taskMinimum: .5, description: "Photonic cloud QPU", available: configured("QUANDELA_EXECUTION_URL") && configured("QUANDELA_API_KEY"), backendName: "MosaiQ", basisGates: ["rz","sx","x","cz"], connectivity: "target", executionModel: "photonic" },
  { id: "qi-starmon-5", provider: "Quantum Inspire", displayName: "Starmon-5", kind: "qpu", status: "degraded", qubits: 5, clops: 800, queueSeconds: 300, fidelity: .97, reliability: .94, pricePerNqh: 40, taskMinimum: .1, description: "Superconducting QPU", available: configured("QI_EXECUTION_URL") && configured("QI_API_KEY"), backendName: "Starmon-5", basisGates: ["x","y","z","h","rx","ry","rz","cz"], connectivity: "target" },
];

const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export function withQciSnapshot(components: QpuComponent[] = []): Backend[] {
  return BACKENDS.map((backend) => {
    const component = components.find((item) => normalized(item.provider) === normalized(backend.provider));
    if (!component) return { ...backend };
    return { ...backend, clops: component.clops || backend.clops, queueSeconds: component.queueSeconds ?? backend.queueSeconds, fidelity: component.fid2q || backend.fidelity, pricePerNqh: component.pricePerNqh || backend.pricePerNqh, status: component.status === "stale" ? "degraded" : backend.status };
  });
}
