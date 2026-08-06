import time
import uuid
from typing import Optional

import httpx


class QRouterError(RuntimeError):
    def __init__(self, message: str, status_code: int, body=None):
        super().__init__(message)
        self.status_code = status_code
        self.body = body


class QRouter:
    def __init__(self, api_key: str, base_url: str = "https://api.qrouter.dev", timeout: float = 120):
        self.client = httpx.Client(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=timeout,
        )

    def close(self):
        self.client.close()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()

    def _request(self, method: str, path: str, **kwargs):
        response = self.client.request(method, path, **kwargs)
        try:
            data = response.json() if response.content else None
        except ValueError:
            data = response.text
        if not response.is_success:
            message = data.get("error", {}).get("message") if isinstance(data, dict) else None
            raise QRouterError(message or response.text, response.status_code, data)
        return data

    @staticmethod
    def _job_input(circuit: str, shots: int, target: str, routing_mode: str,
                   optimization_level: int, constraints, name, failover=True, max_attempts=3,
                   timeout_seconds=7200):
        payload = {
            "circuit": circuit,
            "format": "openqasm3" if "OPENQASM 3" in circuit else "openqasm2",
            "shots": shots,
            "target": target,
            "routing_mode": routing_mode,
            "optimization_level": optimization_level,
            "failover": failover,
            "max_attempts": max_attempts,
            "timeout_seconds": timeout_seconds,
            "constraints": constraints or {},
            "name": name,
        }
        # The API's schema treats optional fields as absent-or-string; JSON null
        # is rejected, so drop unset values entirely.
        return {key: value for key, value in payload.items() if value is not None}

    def transpile(self, circuit: str, *, shots: int = 1024, target: str = "auto",
                  routing_mode: str = "balanced", optimization_level: int = 2,
                  constraints=None, name=None):
        return self._request(
            "POST",
            "/api/v1/transpile",
            json=self._job_input(circuit, shots, target, routing_mode, optimization_level, constraints, name),
        )

    def create_job(self, circuit: str, *, shots: int = 1024, target: str = "auto",
                   routing_mode: str = "balanced", optimization_level: int = 2,
                   constraints=None, name=None, failover: bool = True,
                   max_attempts: int = 3, timeout_seconds: int = 7200,
                   idempotency_key=None):
        return self._request(
            "POST",
            "/api/v1/jobs",
            headers={"Idempotency-Key": idempotency_key or str(uuid.uuid4())},
            json=self._job_input(circuit, shots, target, routing_mode, optimization_level, constraints, name, failover, max_attempts, timeout_seconds),
        )

    def list_jobs(self):
        return self._request("GET", "/api/v1/jobs")

    def get_job(self, job_id: str):
        return self._request("GET", f"/api/v1/jobs/{job_id}")

    def cancel_job(self, job_id: str):
        return self._request("POST", f"/api/v1/jobs/{job_id}/cancel")

    def get_result(self, job_id: str):
        return self._request("GET", f"/api/v1/jobs/{job_id}/result")

    def get_transpiled_qasm(self, job_id: str):
        response = self.client.get(f"/api/v1/jobs/{job_id}/transpiled")
        if not response.is_success:
            try:
                body = response.json()
            except ValueError:
                body = response.text
            message = body.get("error", {}).get("message") if isinstance(body, dict) else response.text
            raise QRouterError(message, response.status_code, body)
        return response.text

    def wait(self, job_id: str, poll_seconds: float = 2, timeout: float = 3600):
        # awaiting_payment counts as settled: it only clears once the caller
        # buys credits, so polling through it just loops until the timeout.
        started = time.monotonic()
        while time.monotonic() - started < timeout:
            job = self.get_job(job_id)
            if job["status"] in {"completed", "failed", "cancelled", "awaiting_payment"}:
                return job
            time.sleep(poll_seconds)
        raise TimeoutError(f"Job {job_id} did not finish within {timeout} seconds")


class QRouterV2(QRouter):
    """Hosted circuit/job/execution API modeled for durable multi-backend runs."""

    # Terminal for polling purposes: awaiting_payment only clears once the
    # caller buys credits, so waiting on it would loop until the timeout.
    _SETTLED = {"completed", "failed", "cancelled", "awaiting_payment"}

    def _request(self, method: str, path: str, **kwargs):
        response = self.client.request(method, path, **kwargs)
        try:
            data = response.json() if response.content else None
        except ValueError:
            data = response.text
        if not response.is_success:
            # v2 answers with RFC 7807 problem+json rather than the v1 error envelope.
            message = None
            if isinstance(data, dict):
                message = data.get("detail") or (data.get("error") or {}).get("message")
            raise QRouterError(message or response.text, response.status_code, data)
        return data

    def create_circuit(self, circuit: str, *, format: Optional[str] = None, name: Optional[str] = None,
                       idempotency_key: Optional[str] = None):
        payload = {
            "circuit": circuit,
            "format": format or ("openqasm3" if "OPENQASM 3" in circuit else "openqasm2"),
        }
        if name is not None:
            payload["name"] = name
        response = self._request(
            "POST", "/api/v2/circuits",
            headers={"Idempotency-Key": idempotency_key or str(uuid.uuid4())}, json=payload,
        )
        return response["data"]

    def get_circuit(self, circuit_id: str):
        return self._request("GET", f"/api/v2/circuits/{circuit_id}")["data"]

    def release_circuit(self, circuit_id: str):
        return self._request("POST", f"/api/v2/circuits/{circuit_id}/release")["data"]

    def delete_circuit(self, circuit_id: str):
        self._request("DELETE", f"/api/v2/circuits/{circuit_id}")

    def create_hosted_job(self, circuit_id: str, executions: list[dict], *, metadata=None,
                          idempotency_key: Optional[str] = None):
        payload = {"circuit_id": circuit_id, "executions": executions, "metadata": metadata or {}}
        try:
            return self._request(
                "POST", "/api/v2/jobs",
                headers={"Idempotency-Key": idempotency_key or str(uuid.uuid4())}, json=payload,
            )["data"]
        except QRouterError as error:
            # 402 still carries the parked job; the caller needs its id to resume
            # the run once credits arrive.
            if error.status_code == 402 and isinstance(error.body, dict) and "data" in error.body:
                return error.body["data"]
            raise

    def get_hosted_job(self, job_id: str):
        return self._request("GET", f"/api/v2/jobs/{job_id}")["data"]

    def wait_hosted_job(self, job_id: str, poll_seconds: float = 2, timeout: float = 3600):
        started = time.monotonic()
        while time.monotonic() - started < timeout:
            job = self.get_hosted_job(job_id)
            if job["status"] in self._SETTLED:
                return job
            time.sleep(poll_seconds)
        raise TimeoutError(f"Hosted job {job_id} did not finish within {timeout} seconds")

    def wait_for_execution(self, job_id: str, execution_id: str, poll_seconds: float = 2, timeout: float = 3600):
        started = time.monotonic()
        while time.monotonic() - started < timeout:
            job = self.get_hosted_job(job_id)
            execution = next((item for item in job["executions"] if item["id"] == execution_id), None)
            if execution is None:
                raise QRouterError(f"Execution {execution_id} is not part of job {job_id}", 404)
            if execution["status"] in self._SETTLED:
                return execution
            time.sleep(poll_seconds)
        raise TimeoutError(f"Execution {execution_id} did not finish within {timeout} seconds")

    def get_execution_result(self, execution_id: str):
        return self._request("GET", f"/api/v2/executions/{execution_id}/result")

    def get_execution_transpiled_qasm(self, execution_id: str):
        response = self.client.get(f"/api/v2/executions/{execution_id}/transpiled")
        if not response.is_success:
            try:
                body = response.json()
            except ValueError:
                body = response.text
            message = body.get("detail") if isinstance(body, dict) else response.text
            raise QRouterError(message, response.status_code, body)
        return response.text

    def cancel_execution(self, execution_id: str):
        return self._request("POST", f"/api/v2/executions/{execution_id}/cancel")["data"]

    def list_backends(self):
        return self._request("GET", "/api/v2/backends")["data"]

    def run(self, circuit: str, *, idempotency_key: Optional[str] = None, **options):
        key = idempotency_key or str(uuid.uuid4())
        circuit_resource = self.create_circuit(circuit, format=options.pop("format", None), name=options.pop("name", None), idempotency_key=f"{key}:circuit")
        execution = {"key": "recommended", **options}
        job = self.create_hosted_job(circuit_resource["id"], [execution], idempotency_key=key)
        completed = self.wait_hosted_job(job["id"])
        target = next((item for item in completed["executions"] if item["key"] == "recommended"), None)
        if target is None or target["status"] != "completed":
            raise QRouterError("Quantum execution failed", 502, completed)
        return self.get_execution_result(target["id"])
