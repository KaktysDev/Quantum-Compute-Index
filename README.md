# QRouter

One API key for quantum compute. QRouter accepts OpenQASM, analyzes and
transpiles the circuit, prices it against a versioned QCI snapshot, routes it to
an eligible provider, reserves credits, and returns a normalized asynchronous
job result.

## QRouter quick start

```bash
curl https://api.qrouter.dev/api/v1/jobs \
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

Run `supabase/schema.sql` and then `supabase/qrouter.sql`. Copy
`.env.local.example` to `.env.local`, configure Google OAuth, Stripe, and the
provider credentials needed in production. The local development server works
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

1. Apply `supabase/schema.sql` and `supabase/qrouter.sql`.
2. Deploy `services/simulator` behind TLS and configure matching compiler/worker tokens.
3. Configure Supabase, Stripe, artifact encryption, cron, and provider credentials from `.env.local.example`.
4. Configure an external one-minute scheduler for `GET /api/internal/jobs`, an every-two-minute scheduler for `GET /api/internal/providers/health`, and the Stripe webhook.
5. Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
6. Run credentialed smoke jobs against each enabled paid provider before exposing that backend in production.

`vercel.json` intentionally contains only the once-daily index refresh cron so
the project can deploy on Vercel Hobby. The QRouter execution pollers run more
than once per day, so host those on Vercel Pro Cron, GitHub Actions, or a small
Vultr instance running cron. Send `Authorization: Bearer $CRON_SECRET` with each
poller request.

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
