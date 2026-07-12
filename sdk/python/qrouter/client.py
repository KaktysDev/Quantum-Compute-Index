import time
import uuid

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
                   optimization_level: int, constraints, name):
        return {
            "circuit": circuit,
            "format": "openqasm3" if "OPENQASM 3" in circuit else "openqasm2",
            "shots": shots,
            "target": target,
            "routing_mode": routing_mode,
            "optimization_level": optimization_level,
            "constraints": constraints or {},
            "name": name,
        }

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
                   constraints=None, name=None, idempotency_key=None):
        return self._request(
            "POST",
            "/api/v1/jobs",
            headers={"Idempotency-Key": idempotency_key or str(uuid.uuid4())},
            json=self._job_input(circuit, shots, target, routing_mode, optimization_level, constraints, name),
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
        started = time.monotonic()
        while time.monotonic() - started < timeout:
            job = self.get_job(job_id)
            if job["status"] in {"completed", "failed", "cancelled"}:
                return job
            time.sleep(poll_seconds)
        raise TimeoutError(f"Job {job_id} did not finish within {timeout} seconds")
