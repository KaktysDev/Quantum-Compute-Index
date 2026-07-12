import base64
import io
import unittest

from qiskit import qpy

from app import JOBS, JobInput, TranspileInput, TranspileTarget, compile_circuit, execute


BELL = '''OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
measure q -> c;'''


class CompilerTest(unittest.TestCase):
    def test_executes_bell_circuit_on_an_available_aer_device(self):
        job_id = "test-bell"
        JOBS[job_id] = {"id": job_id, "status": "submitted"}
        execute(job_id, JobInput(qasm=BELL, shots=128))
        self.assertEqual(JOBS[job_id]["status"], "completed")
        self.assertEqual(sum(JOBS[job_id]["result"]["counts"].values()), 128)
        self.assertTrue(set(JOBS[job_id]["result"]["counts"]).issubset({"00", "11"}))

    def test_compiles_to_coupling_map_and_round_trips_qpy(self):
        result = compile_circuit(TranspileInput(
            qasm=BELL,
            target=TranspileTarget(
                backend_id="test-line",
                provider="test",
                num_qubits=3,
                basis_gates=["rz", "sx", "x", "cx"],
                connectivity="custom",
                coupling_map=[[0, 1], [1, 0], [1, 2], [2, 1]],
            ),
            optimization_level=2,
        ))
        circuit = qpy.load(io.BytesIO(base64.b64decode(result["providerProgram"]["data"])))[0]
        self.assertEqual(result["artifactQasm"].splitlines()[0], "OPENQASM 3.0;")
        self.assertEqual(circuit.num_qubits, 3)
        self.assertEqual(circuit.count_ops()["cx"], 1)

    def test_rejects_unknown_hardware_topology(self):
        with self.assertRaisesRegex(ValueError, "requires a live provider target"):
            compile_circuit(TranspileInput(
                qasm=BELL,
                target=TranspileTarget(
                    backend_id="unknown-qpu",
                    provider="test",
                    num_qubits=3,
                    basis_gates=["rz", "sx", "x", "cx"],
                    connectivity="target",
                ),
            ))


if __name__ == "__main__":
    unittest.main()
