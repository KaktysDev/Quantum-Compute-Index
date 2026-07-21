# QRouter Qiskit worker

This service is the Vultr-hosted execution and compilation layer for QRouter. It
does not replace QCI routing, pricing, or provider selection, and it is not
presented as a physical QPU. QRouter selects a backend and creates the quote;
this worker executes Qiskit Aer simulator jobs and compiles circuits for the
selected provider target.

## Local verification

Run the CPU-compatible contract suite from the repository root:

```bash
python3 -m pip install -r services/simulator/requirements-ci.txt
PYTHONPATH=services/simulator python3 -m unittest discover -s services/simulator -p 'test_*.py' -v
```

The production image installs `qiskit-aer-gpu` and uses the NVIDIA runtime. Its
API is:

- `GET /health`: public load-balancer readiness; returns 503 when
  `REQUIRE_GPU=true` and Aer cannot access the GPU.
- `GET /metrics`: token-protected JSON capacity and job counters.
- `POST /v1/jobs`, `GET /v1/jobs/{id}`, `DELETE /v1/jobs/{id}`: durable,
  idempotent simulator execution.
- `POST /v1/transpile`: target-aware Qiskit compilation with QPY output and
  equivalence checks.
- `/v1/providers/ibm/jobs/*`: optional IBM Runtime execution bridge.

## Vultr pilot deployment

1. Provision one Vultr Cloud GPU instance with an NVIDIA driver and Docker's
   NVIDIA container runtime. Point a DNS A record at the instance.
2. Build `services/simulator/Dockerfile`, publish it to a private registry, and
   set that image as `QROUTER_WORKER_IMAGE` in `deploy/vultr/.env`.
3. Populate `deploy/vultr/.env` from `.env.example`. Generate a distinct random
   `SIMULATOR_TOKEN`, keep `REQUIRE_GPU=true`, and set the DNS name and ACME
   email used by Caddy.
4. From `services/simulator/deploy/vultr`, run
   `docker compose pull && docker compose up -d`, then verify that
   `https://$WORKER_DOMAIN/health` reports `device: GPU`.
5. Set the web tier's `VULTR_SIMULATOR_URL` and `VULTR_SIMULATOR_TOKEN` to the
   worker URL and shared token. `QROUTER_COMPILER_URL` can point to the same URL.

The Compose deployment exposes only Caddy on ports 80/443, obtains TLS
certificates automatically, mounts a durable job database, runs the worker as a
non-root user with a read-only filesystem, and refuses CPU fallback. The worker
returns HTTP 429 with `Retry-After` when `MAX_QUEUED_JOBS` is reached.

## Pilot operations

Use `/metrics` with the bearer token to monitor active jobs, capacity, terminal
job counts, uptime, and the actual Aer device. Result metadata includes
`executionMs`, shots, qubits, depth, and device; QRouter retains the QCI quote
and rate snapshot separately so estimated price and measured usage remain
auditable.

SQLite is deliberately a single-worker pilot design. Do not add a second worker
behind the same hostname until the job store and executor are moved to a shared
database/queue. A production multi-node version should use Postgres for job
state and a durable queue, while retaining these API paths and idempotency keys.

For IBM compilation, set `IBM_QUANTUM_TOKEN`, `IBM_QUANTUM_INSTANCE`, and
`IBM_QUANTUM_BACKEND` on the worker. The worker retrieves the live `BackendV2`
target and submits the exact transpiled QPY through `SamplerV2`; credentials are
never returned through QRouter's public API.
