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

## Bare-metal deployment (no Docker)

Use this when the instance runs the worker directly under systemd instead of
Compose. Assets are in `deploy/native/`. The topology is identical to the
Compose one — uvicorn on loopback, Caddy as the only ingress on 80/443 — so the
web tier configuration does not change between the two.

1. Point a DNS A record for the worker hostname at the instance. **ACME cannot
   issue a certificate for a bare IP**, so an IP-only setup leaves Caddy without
   a certificate and every TLS handshake fails with `internal error`.
2. Create the service account and directories:

   ```bash
   sudo useradd --system --home /opt/qrouter --shell /usr/sbin/nologin qrouter
   sudo mkdir -p /opt/qrouter/simulator /var/lib/qrouter /etc/qrouter
   sudo chown -R qrouter:qrouter /opt/qrouter /var/lib/qrouter
   ```

3. Install the code and a virtualenv (`qiskit-aer-gpu` needs the NVIDIA driver
   and a matching CUDA runtime already present on the host):

   ```bash
   sudo -u qrouter python3 -m venv /opt/qrouter/venv
   sudo -u qrouter /opt/qrouter/venv/bin/pip install -r requirements.txt
   sudo install -o qrouter -g qrouter -m 0644 app.py /opt/qrouter/simulator/app.py
   ```

4. Install the environment file from `deploy/native/worker.env.example` to
   `/etc/qrouter/worker.env` and generate a real `SIMULATOR_TOKEN`. It holds the
   shared secret, so restrict it:

   ```bash
   sudo chown root:qrouter /etc/qrouter/worker.env && sudo chmod 0640 /etc/qrouter/worker.env
   ```

5. Install and start the unit:

   ```bash
   sudo install -m 0644 deploy/native/qrouter-worker.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now qrouter-worker
   ```

6. Install `deploy/native/Caddyfile` to `/etc/caddy/Caddyfile`, set
   `WORKER_DOMAIN` and `ACME_EMAIL` in `/etc/default/caddy`, then
   `sudo systemctl reload caddy`. Watch `journalctl -u caddy -f` for
   `certificate obtained successfully`.
7. Verify `https://$WORKER_DOMAIN/health` reports `device: GPU`, then set the
   web tier's `VULTR_SIMULATOR_URL` and `VULTR_SIMULATOR_TOKEN` as in step 5 of
   the Compose deployment above.

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
