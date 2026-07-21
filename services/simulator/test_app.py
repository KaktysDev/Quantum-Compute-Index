import base64
import io
import tempfile
import time
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from qiskit import qpy

import app as worker
from app import JobInput, TranspileInput, TranspileTarget, compile_circuit, execute, get_stored_job, insert_stored_job


BELL = '''OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
measure q -> c;'''


class CompilerTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_path = worker.JOB_DB_PATH
        self.original_token = worker.TOKEN
        self.original_require_gpu = worker.REQUIRE_GPU
        self.original_max_queued_jobs = worker.MAX_QUEUED_JOBS
        worker.JOB_DB_PATH = f"{self.temp_dir.name}/jobs.sqlite3"
        worker.TOKEN = "test-worker-token"
        worker.REQUIRE_GPU = False
        worker.MAX_QUEUED_JOBS = 10
        worker.initialize_database()
        self.client = TestClient(worker.app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        worker.JOB_DB_PATH = self.original_db_path
        worker.TOKEN = self.original_token
        worker.REQUIRE_GPU = self.original_require_gpu
        worker.MAX_QUEUED_JOBS = self.original_max_queued_jobs
        self.temp_dir.cleanup()

    def wait_for_job(self, job_id):
        for _ in range(100):
            job = get_stored_job(job_id)
            if job and job["status"] in {"completed", "failed", "cancelled"}:
                return job
            time.sleep(0.02)
        self.fail(f"Job {job_id} did not finish")

    def test_executes_bell_circuit_on_an_available_aer_device(self):
        job_id = "test-bell"
        payload = JobInput(qasm=BELL, shots=128)
        try:
            insert_stored_job(job_id, payload)
        except Exception:
            pass
        execute(job_id, payload)
        job = get_stored_job(job_id)
        self.assertEqual(job["status"], "completed")
        self.assertEqual(sum(job["result"]["counts"].values()), 128)
        self.assertTrue(set(job["result"]["counts"]).issubset({"00", "11"}))

    def test_reuses_a_persisted_job_for_the_same_idempotency_key(self):
        payload = JobInput(qasm=BELL, shots=16)
        first = worker.create_job(payload, "simulator-idempotency-test")
        second = worker.create_job(payload, "simulator-idempotency-test")
        self.assertEqual(first["id"], second["id"])
        self.wait_for_job(first["id"])

    def test_http_job_contract_requires_auth_and_returns_results(self):
        unauthorized = self.client.post("/v1/jobs", json={"qasm": BELL, "shots": 32})
        self.assertEqual(unauthorized.status_code, 401)

        response = self.client.post(
            "/v1/jobs",
            headers={"Authorization": "Bearer test-worker-token", "Idempotency-Key": "http-contract"},
            json={"qasm": BELL, "shots": 32},
        )
        self.assertEqual(response.status_code, 202)
        job_id = response.json()["id"]
        job = self.wait_for_job(job_id)
        self.assertEqual(job["status"], "completed")
        self.assertEqual(sum(job["result"]["counts"].values()), 32)
        status = self.client.get(f"/v1/jobs/{job_id}", headers={"Authorization": "Bearer test-worker-token"})
        self.assertEqual(status.status_code, 200)
        self.assertEqual(status.json()["result"]["metadata"]["engine"], "Qiskit Aer")

    def test_reports_authenticated_capacity_metrics(self):
        response = self.client.get("/metrics", headers={"Authorization": "Bearer test-worker-token"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["maxQueuedJobs"], 10)
        self.assertIn(response.json()["device"], {"CPU", "GPU"})
        self.assertEqual(self.client.get("/metrics").status_code, 401)

    def test_gpu_required_health_fails_when_aer_has_no_gpu(self):
        with patch.object(worker, "REQUIRE_GPU", True), patch.object(worker.AerSimulator, "available_devices", return_value=("CPU",)):
            response = self.client.get("/health")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["status"], "not_ready")

    def test_rejects_new_jobs_when_queue_is_at_capacity(self):
        worker.MAX_QUEUED_JOBS = 1
        insert_stored_job("queued-job", JobInput(qasm=BELL, shots=16))
        response = self.client.post(
            "/v1/jobs",
            headers={"Authorization": "Bearer test-worker-token"},
            json={"qasm": BELL, "shots": 16},
        )
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.headers["retry-after"], "5")

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
