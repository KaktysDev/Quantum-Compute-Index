# QRouter

A private workspace for quantum experiment campaigns: record the question, approve an execution budget, and keep circuit inputs, provider attempts, and result evidence together.

The initial audience is a small technical team running recurring quantum experiments. Bring an existing circuit and domain knowledge. QRouter supports the execution and review workflow; it does not infer algorithm correctness or quantum advantage from a completed job.

## Product workflow

Open **Dashboard → Experiments** (`/dashboard/experiments`).

1. Define the objective, circuit, reference distribution (or an explicit reason for no reference), and success criterion.
2. Choose simulation or explicit hardware intent, target backends, shots, and a total campaign budget.
3. Review the execution plan and approve its complete quote before running.
4. Review measured results alongside source, execution context, and the criterion. Finite sampling can make an assessment inconclusive.

Create a new definition when changing an experiment's inputs or plan; preserve the original record for comparison. Tenant-scoped storage keeps campaigns within their workspace. Follow the retention controls when releasing source or result artifacts.

The campaign API lives under `/api/v2/experiments`. Existing v1 jobs and v2 circuits/execution groups remain the underlying execution primitives. See `/docs` for the workflow and API reference.

## Quotes and budgets

Quotes use a dated native provider rate for the exact execution channel, not the Quantum Compute Index. Unknown, invalid, mismatched, or expired native rates exclude a backend from paid routing. Operator configuration uses `QROUTER_NATIVE_RATES_JSON`; the internal simulator has its own stated tariff.

Each execution quote separates:

- Provider reservation: the native execution estimate multiplied by the allowed attempt budget.
- Compilation fee: `$0.01 + $0.00002 × compiled gates + $0.00008 × compiled two-qubit gates`. Two-qubit gates also count toward the total gate count.
- Platform fee: the greater of `$0.005` and `8%` of the provider reservation.

The all-in spend limit includes software fees and permitted attempts. A campaign combines its execution quotes. Quotes expire after 15 minutes and credits are reserved before submission. Provider estimates are not invoices; actual-cost reporting varies by integration. Keep reported costs and estimates distinguishable when reviewing settlement. The current commercial model is per-execution quotes and prepaid credits; subscription tiers and campaign-service pricing have not been validated or launched.

See [pricing](src/app/pricing/page.tsx), [native pricing](src/lib/qrouter/pricing.ts), and the credit and quote terms on `/terms#credits`.

## Preview a circuit without execution

The compile-and-quote endpoint submits no provider job:

```bash
curl https://qrouter.app/api/v1/transpile \
  -H "Authorization: Bearer $QROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "format": "openqasm2",
    "circuit": "OPENQASM 2.0; include \"qelib1.inc\"; qreg q[2]; creg c[2]; h q[0]; cx q[0],q[1]; measure q -> c;",
    "shots": 1024,
    "target": "qci-aer-gpu",
    "failover": false,
    "constraints": { "kind": "simulator", "maxCost": 1 }
  }'
```

The stable simulator id `qci-aer-gpu` is retained for compatibility; the displayed CPU/GPU capability depends on the configured worker. Automatic routes default to simulation. Running on physical hardware requires explicit intent and a supported, configured provider integration.

## Existing execution interfaces

- `POST /api/v1/transpile`: analyze, check compatibility, compile, and quote without submitting.
- `POST /api/v1/jobs`: create a single asynchronous execution.
- `POST /api/v2/circuits`: store a reusable circuit.
- `POST /api/v2/jobs`: create an execution group; `Idempotency-Key` is required, and credits are reserved for the group together.
- Results, compilation artifacts, attempt/event traces, and signed webhooks support integration with your existing tools.

The terminal client lives in [`cli/`](cli/README.md). TypeScript and Python clients live in [`sdk/`](sdk/). Repository workflows pin an OpenQASM source file to a commit rather than executing arbitrary repository code.

Keys created in **Dashboard → API keys** authenticate the workspace. Provider credentials stay server-side. Test keys are simulator-only; a target appearing in the catalog does not demonstrate live access.

## Research index

The Quantum Compute Index remains a secondary **research view** at `/dashboard/qci`. It aggregates selected published rates using a model of hardware capability and includes separately modelled production-cost scenarios. It is not a transaction benchmark, a job price, or evidence that a particular circuit will succeed. It does not determine execution fees or substitute for native pricing provenance.

See [QCI methodology](docs/QCI-METHODOLOGY.md) for assumptions and [product/commercial roadmap](docs/PRODUCT-ROADMAP.md) for the decision to keep index research outside the main execution journey.

## Local development and operations

```bash
npm ci
npm run dev
```

For a credential-free local campaign preview, use
`QROUTER_DEMO_MODE=true QROUTER_DEV_AUTH_BYPASS=true npm run dev`.
This development-only mode runs the internal simulator in process, ignores
external execution credentials, and does not debit a real account.

Copy `.env.local.example` to `.env.local` for configured services. Local development supports a simulator-only demo principal; this is not a production authentication mode.

Operator runbooks:

- [`supabase/WHAT-TO-RUN.md`](supabase/WHAT-TO-RUN.md)
- [`supabase/APPLY-V2-MIGRATION.md`](supabase/APPLY-V2-MIGRATION.md)
- [`services/simulator/README.md`](services/simulator/README.md)
- [`docs/TRY-THE-API.md`](docs/TRY-THE-API.md)
- [`docs/EXPERIMENT-ROLLOUT.md`](docs/EXPERIMENT-ROLLOUT.md)

Apply required migrations before exposing campaign persistence in production. Configure Supabase, artifact encryption, billing, the authenticated compiler/worker, provider credentials, dated native rate cards, and authenticated polling/health schedulers. Enabled paid providers require credentialed smoke verification; adapters and catalog entries alone are insufficient.

`vercel.json` schedules index refresh only. Execution polling requires its own authenticated scheduler. A workspace-owned `/api/v1/jobs/{id}/advance` endpoint can drive one eligible funded job forward; it is not a replacement for fleet operations.

Validation:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Product boundaries and planned work are recorded in [`docs/PRODUCT-ROADMAP.md`](docs/PRODUCT-ROADMAP.md). No customer interviews, willingness-to-pay evidence, or market validation should be inferred from the implementation.
