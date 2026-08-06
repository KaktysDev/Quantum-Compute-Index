# QRouter

One API key for quantum compute. QRouter accepts OpenQASM, analyzes and
transpiles the circuit, prices it against a versioned QCI snapshot, routes it to
an eligible provider, reserves credits, and returns a normalized asynchronous
job result.

## Start here

```bash
npx qrouter.app
```

Paste your API key once. QRouter verifies it, tells you what it can reach, and
opens the same AI assistant the console runs — in your terminal. Describe a run
("run the quantum job at https://github.com/owner/repo on the qci cpu") and it
prepares the job; you see QRouter's own quote and selected backend, and nothing
executes until you type `run`. Results are written to your Downloads folder as
`qrouter quantum results ___<provider>___ <timestamp>.json`.

The client lives in [`cli/`](cli/) and is documented in
[`cli/README.md`](cli/README.md). Scripts can skip the conversation:
`qrouter run ./bell.qasm --shots 1024 --yes`.

## Try it on your account

- End-to-end smoke guide (API key + GitHub repo or pasted OpenQASM):
  [`docs/TRY-THE-API.md`](docs/TRY-THE-API.md)

### Operators only (do not publish as customer docs)

Database apply runbooks for people who administer the Supabase project. They
include migration order and security-hardening steps that are not part of the
public API surface:

- [`supabase/WHAT-TO-RUN.md`](supabase/WHAT-TO-RUN.md)
- [`supabase/APPLY-V2-MIGRATION.md`](supabase/APPLY-V2-MIGRATION.md)

## QRouter quick start

```bash
curl https://qrouter.app/api/v1/jobs \
  -H "Authorization: Bearer qci_live_..." \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: bell-001" \
  -d '{
    "format": "openqasm2",
    "circuit": "OPENQASM 2.0; include \"qelib1.inc\"; qreg q[2]; creg c[2]; h q[0]; cx q[0],q[1]; measure q -> c;",
    "shots": 1024,
    "target": "auto",
    "routing_mode": "balanced",
    "failover": true,
    "max_attempts": 3,
    "timeout_seconds": 7200,
    "constraints": { "maxCost": 2.00 }
  }'
```

### v2: reusable circuits and multi-backend jobs

`/api/v2` takes the same `qci_*` key and splits the v1 job into a stored circuit
plus a parent job that fans out into independent executions, so one circuit can
be compared across backends without being re-uploaded. `Idempotency-Key` is
**required** on `POST /api/v2/circuits` and `POST /api/v2/jobs`, and is scoped
per organization; replaying a key returns the stored response with
`idempotent-replayed: true`, while reusing it with a different payload is a
`409 idempotency_conflict`. Errors are RFC 7807 `application/problem+json` and
every response carries `x-request-id`.

```bash
CIRCUIT=$(curl -s https://qrouter.app/api/v2/circuits \
  -H "Authorization: Bearer qci_live_..." -H "Content-Type: application/json" \
  -H "Idempotency-Key: bell-circuit-001" \
  -d '{ "circuit": "OPENQASM 2.0; include \"qelib1.inc\"; qreg q[2]; creg c[2]; h q[0]; cx q[0],q[1]; measure q -> c;" }' \
  | jq -r .data.id)

curl https://qrouter.app/api/v2/jobs \
  -H "Authorization: Bearer qci_live_..." -H "Content-Type: application/json" \
  -H "Idempotency-Key: bell-job-001" \
  -d "{
    \"circuit_id\": \"$CIRCUIT\",
    \"executions\": [
      { \"key\": \"recommended\", \"target\": \"auto\", \"shots\": 1024 },
      { \"key\": \"simulator\", \"target\": \"qci-aer-gpu\", \"shots\": 1024 }
    ]
  }"
```

Credits for every execution in a job are quoted and reserved together, so a
comparison never starts half-funded; an underfunded job returns `402` with the
parked job body and resumes once credits arrive. `POST /api/v2/circuits/{id}/release`
purges stored source/results, attempt and webhook payloads, and compiled artifacts
once every job is terminal; `DELETE /api/v2/circuits/{id}` runs the same scrub and
removes the circuit record. `qci_test_` keys are simulator-only; scopes are enforced
for API-key principals.

Run the Supabase files in this order: `supabase/schema.sql`, then
`supabase/qrouter.sql`, then `supabase/admin.sql`, then `supabase/access.sql`,
then `supabase/chat.sql`, then `supabase/contact.sql`. `admin.sql` must precede
`access.sql`, and skipping `access.sql` locks everyone out of `/dashboard`
because console access fails closed. Copy `.env.local.example` to `.env.local`,
configure Google OAuth, Stripe, and the provider credentials needed in
production. The local development server works
without cloud credentials and exposes the test key
`qci_test_local_development` outside production.

### What the platform key does

Keys created in **Dashboard -> API keys** authenticate against a SHA-256 hash in
Supabase. Client applications send only that `qci_live_*` key. QRouter applies
organization rate limits, compiles and prices the circuit, reserves QCI credits,
and uses server-side provider credentials to submit the provider job. Provider
tokens are never returned to the client.

```ts
import { QRouter } from "@qrouter/sdk";

const qrouter = new QRouter(process.env.QROUTER_API_KEY!);
const preview = await qrouter.transpile({ circuit, target: "auto", optimization_level: 2 });
const job = await qrouter.jobs.create({ circuit, shots: 1024, target: "auto" });
const completed = await qrouter.jobs.wait(job.id);
const result = await qrouter.jobs.result(completed.id);
```

The Python client in `sdk/python` exposes the same `transpile`, `create_job`,
`wait`, `get_result`, and `get_transpiled_qasm` workflow. The complete HTTP
contract is published at `/openapi.json`.

### Execution coverage

- QCI Aer uses the authenticated GPU/CPU Qiskit worker.
- IBM uses a live `BackendV2` target, QPY handoff, and the official Qiskit Runtime `SamplerV2` client.
- IonQ uses the v0.4 QIS API directly, with Braket as the configured fallback.
- Amazon SV1 and IQM Garnet use Braket; Garnet connectivity comes from current device capabilities before routing.
- Quantum Inspire uses the configured approved execution bridge.
- Xanadu and Quandela are capability-gated. Arbitrary gate-model OpenQASM is not silently translated to photonic programs; a native-input bridge is required.

### Production checklist

1. Apply the Supabase files in order: `schema.sql`, `qrouter.sql`, `admin.sql`, `access.sql`, `chat.sql`, `contact.sql`.
2. Deploy `services/simulator` behind TLS and configure matching compiler/worker tokens.
3. Configure Supabase, Stripe, artifact encryption, authenticated schedulers, and provider credentials from `.env.local.example`.
4. Configure external authenticated schedulers for job polling, provider health checks, and the Stripe webhook (see `.env.local.example` for the required secrets).
5. Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
6. Run credentialed smoke jobs against each enabled paid provider before exposing that backend in production.

`vercel.json` intentionally contains only the once-daily index refresh cron so
the project can deploy on Vercel Hobby. The QRouter execution pollers run more
than once per day, so host those on Vercel Pro Cron, GitHub Actions, or a small
Vultr instance running cron — always with the shared scheduler secret from your
environment, never unauthenticated.

Until that scheduler exists, a submitted job would sit in `queued` forever, so
`POST /api/v1/jobs/{id}/advance` lets a job's own workspace drive it: it runs the
same dispatch and poll code as `/api/internal/jobs`, but for exactly one job,
filtered on the caller's `organization_id`, and only when that job carries both a
quote and a matching `reserve` ledger entry. The terminal client calls it while
it waits. It complements the scheduler rather than replacing it — a fleet with
real traffic still wants the cron.

The execution worker atomically leases queued jobs and active provider polls.
Failed attempts can move to the next compatible route candidate when `failover`
is enabled, but only when that candidate stays within the accepted provider-cost
quote. `GET /api/v1/jobs/{id}` returns both the attempt history and event trace.
Two fresh provider-health failures open a routing circuit breaker. Execution
deadlines cancel the active provider job before failover, provider results are
normalized to `counts`, `probabilities`, `shots`, and `backend`, and signed
webhooks use a durable retry outbox instead of one-shot delivery.

### Optional infrastructure substitutions

QRouter's routing and pricing logic stays provider-neutral. Vultr can be used as
an implementation detail where it replaces infrastructure cleanly:

- QRouter's unified API routes quantum workloads, not language-model requests.
  QCI deterministically selects and prices quantum backends; Gemini and other
  optional language models explain that result but cannot change it.
- Gemini powers the console assistant and is the preferred Route Advisor
  explanation layer. Optional OpenAI-compatible commentary can use
  `VULTR_INFERENCE_*` first and `OPENROUTER_*` as a fallback;
  `AI_PROVIDER_ORDER` defaults to `vultr,openrouter`. If every language model is
  unavailable, QRouter still returns its deterministic route and quote.
- `VULTR_OBJECT_STORAGE_*` stores encrypted source/transpiled/result artifacts in
  S3-compatible object storage instead of Supabase Storage.
- `VULTR_SIMULATOR_URL` can point at the Qiskit/Aer simulator/compiler worker
  when that service is hosted on Vultr GPU compute. A pilot-ready single-node
  Docker Compose deployment with automatic TLS, GPU readiness enforcement,
  durable jobs, queue limits, and metrics is in
  `services/simulator/deploy/vultr`.

The original Quantum Compute Index implementation remains the pricing oracle
and is documented below.

# Quantum Compute Index

The financial layer for quantum computing. A web app that publishes the **Quantum
Compute Index (QCI)** — a performance-adjusted benchmark for the price and utility
of an hour of quantum compute across IBM, IonQ, Rigetti, IQM and more — and a gated,
glassmorphism dashboard where approved partners connect quantum-cloud providers that
feed the index.

- **Public landing page** — live QCI price, animated brand identity, about section. No login.
- **Google sign-in, invite-only** — restricted to an email allowlist (Supabase).
- **Dashboard** — current QCI, chart, index constituents, and a Settings tab to paste provider API keys.
- **Daily refresh at 9:30 AM ET** — Vercel Cron computes & stores a new index snapshot.
- **Works before any keys exist** — shows clearly-labeled *sample data*, then auto-switches to live data once a provider key is added.


## How the index works

The QCI implements the formula from *QCI Research 1.1* (Lahoda & Flowers). The math
lives in [`src/lib/qci/`](src/lib/qci/) and is the place to tune the index.

**Base index — PQF-weighted VWAP:**

```
I = Σ(P_trans · V_trans · PQF) / Σ(V_trans · PQF)
```

**Performance Quality Factor per QPU:**

```
PQF_i = α·(log2(QV_i)/log2(QV_base)) + β·(CLOPS_i/CLOPS_base) + γ·F_2q_i
```

The displayed QCI is anchored to **1000 at inception** (S&P-style), computed from the
seed benchmark basket in [`seed.ts`](src/lib/qci/seed.ts).

**Tuning knobs:**
- `formula.ts` — coefficients `α, β, γ` and base constants (`DEFAULT_CONFIG`).
- `normalize.ts` — `$/min` and `$/shot` → Normalized Quantum Hour conversion.
- `marketAdjust.ts` — optional queue / demand / equity overlay (off by default).
- `seed.ts` — the benchmark table used for the inception reference & sample data.

**Documented modeling decisions (see code comments):**
- The index is defined over *transactions*; until a real order book exists, `V_trans`
  uses a documented **volume proxy** (provider capacity × demand).
- Provider prices use different units, normalized to a QC-hour via explicit assumptions.
- The research table's PQF values are *estimates* (e.g. IonQ AQ); the formula is
  implemented faithfully and the table is used only as seed/defaults.

## Going live with a provider

1. Sign in → **Dashboard → Settings**.
2. Paste an API key for a provider (e.g. AWS Braket, which covers IonQ/Rigetti/IQM).
3. At the next 9:30 AM ET refresh (or a forced run), the cron pulls that provider's
   metrics, computes the live index, and the app switches from sample to **live** data.

> The adapters in [`src/lib/providers/`](src/lib/providers/) feed QCI index telemetry,
> not QRouter execution. Their benchmark fallback must be replaced with licensed live
> pricing/calibration sources before describing the public index itself as live market data.
