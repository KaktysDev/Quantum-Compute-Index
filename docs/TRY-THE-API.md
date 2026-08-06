# Try the API today

Practical smoke guide: generate a QRouter API key, then run a circuit from your
GitHub repo (or paste OpenQASM directly). Matches the current working tree.

Full reference: in-app [`/docs`](../src/app/docs/page.tsx), OpenAPI at
`/openapi.json`, SDKs in `sdk/python` and `sdk/typescript`.

---

## Before you start

1. **Database** — operators must apply the current Supabase migrations
   (`qrouter.sql` and related files) so v2 tables and job dispatch match this
   code. That work is documented in the operators-only runbooks under
   `supabase/` (not customer-facing product docs).
2. **Console access** — sign in and reach `/dashboard` (allowlisted / approved).
3. **Credits** — new orgs get a signup grant of **10 credits**. Buy more at
   `/dashboard/billing` if you see `402` / `insufficient_credits`.
4. **Provider keys** — simulators may work with the bundled/local worker; real
   QPUs need server-side provider credentials configured on the deployment.
5. **Base URL**
   - Local: `http://localhost:3000`
   - Deployed: your site origin, or the public API host
     (`https://api.qrouter.dev`). Same path prefixes: `/api/v1/...`, `/api/v2/...`.

```bash
export BASE_URL="http://localhost:3000"   # or https://your-deployed-host
export QROUTER_API_KEY="qci_live_..."     # paste once from the console
```

---

## Create an API key

1. Sign in → open **Console** (`/dashboard`).
2. Go to **`/dashboard/api-keys`**.
3. Create a key (environment **live** or **test**). Copy the secret once —
   only the prefix is stored afterward.
4. Keys look like `qci_live_…` or `qci_test_…`.

Send on every request:

```http
Authorization: Bearer qci_live_...
```

Keys are minted only from a console session. Calling the key endpoint with a
Bearer API key returns `403`.

### Actual `qci_test_` behavior (code today)

| Behavior | Current code |
|----------|----------------|
| Same workspace / same credit balance as live | Yes |
| Scopes (`jobs:read` / `jobs:write`) | Enforced on API routes |
| Backend filter | **Test keys are limited to simulators**. Pinning a QPU target returns 403. `"target": "auto"` stays on simulators. |
| Still spends credits | Yes — simulator runs are still quoted and reserved |

Use a **live** key if you intentionally want a QPU. Prefer a **test** key plus
`target: "auto"` (or an explicit simulator id) for cheap smoke tests.

---

## Path 1 — Repository deployment (preferred with GitHub App)

### 1. Connect GitHub

1. Open **`/dashboard/github`**.
2. Install / connect the GitHub App if the page offers it (needs
   `GITHUB_APP_*` env on the deployment).
3. Import the repository, pick the production branch and a `.qasm` entrypoint.

### 2. Add `qrouter.json` in the repo root (or any path; first match wins)

Schema loaded by the console import (`GitHubManager`):

```json
{
  "circuit": "circuits/bell.qasm",
  "shots": 1024,
  "target": "auto",
  "routing_mode": "balanced",
  "optimization_level": 2
}
```

- `circuit` — path to a `.qasm` file (relative to repo root).
- `routing_mode` — `balanced` | `cost` | `speed` | `quality`.
- Other defaults come from project settings if omitted.

### 3. Deploy

**Console:** use the repository deployments UI after import (playground /
deployments surface under the dashboard).

**API:**

```bash
curl "$BASE_URL/api/v1/repository-jobs" \
  -H "Authorization: Bearer $QROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "YOUR-PROJECT-UUID",
    "deployment_id": "smoke-001"
  }'
```

Optional overrides: `ref`, `circuit_path`, `settings` (`shots`, `target`,
`routingMode`, `optimizationLevel`, …). See OpenAPI / in-app docs for the full
request schema.

Idempotency for repo deploys is automatic from the project and deployment
identifiers.

### 4. Poll status and fetch result

```bash
JOB_ID="..."   # from the create response

curl "$BASE_URL/api/v1/jobs/$JOB_ID" \
  -H "Authorization: Bearer $QROUTER_API_KEY"

curl "$BASE_URL/api/v1/jobs/$JOB_ID/result" \
  -H "Authorization: Bearer $QROUTER_API_KEY"
```

Useful: `GET /api/v1/jobs/$JOB_ID/transpiled`,
`POST /api/v1/jobs/$JOB_ID/cancel`.

List deploys for a project:
`GET /api/v1/repository-jobs?project_id=YOUR-PROJECT-UUID`.

---

## Path 2 — Direct API with local OpenQASM (no GitHub App)

Works with only an API key + credits. Best first smoke test.

### v1 quick path — Bell circuit

`Idempotency-Key` is **optional** on v1 job create (recommended).

```bash
curl "$BASE_URL/api/v1/jobs" \
  -H "Authorization: Bearer $QROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: bell-smoke-001" \
  -d '{
    "format": "openqasm2",
    "circuit": "OPENQASM 2.0; include \"qelib1.inc\"; qreg q[2]; creg c[2]; h q[0]; cx q[0],q[1]; measure q -> c;",
    "shots": 1024,
    "target": "auto",
    "routing_mode": "balanced",
    "optimization_level": 2
  }'
```

Then poll / result as in Path 1.

Console alternative without curl: **`/dashboard/submit`** (session cookie auth)
or the playground pages under `/dashboard/playground`.

### v2 path — circuit → job → poll → result

`Idempotency-Key` is **required** on `POST /api/v2/circuits` and
`POST /api/v2/jobs` (8–255 characters).

```bash
# 1) Store circuit
CIRCUIT=$(curl -s "$BASE_URL/api/v2/circuits" \
  -H "Authorization: Bearer $QROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: bell-circuit-001" \
  -d '{
    "name": "bell",
    "format": "openqasm2",
    "circuit": "OPENQASM 2.0; include \"qelib1.inc\"; qreg q[2]; creg c[2]; h q[0]; cx q[0],q[1]; measure q -> c;"
  }' | jq -r .data.id)

# 2) Create execution group (job)
JOB=$(curl -s "$BASE_URL/api/v2/jobs" \
  -H "Authorization: Bearer $QROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: bell-job-001" \
  -d "{
    \"circuit_id\": \"$CIRCUIT\",
    \"executions\": [
      { \"key\": \"recommended\", \"target\": \"auto\", \"shots\": 1024 }
    ]
  }")
echo "$JOB" | jq .
JOB_ID=$(echo "$JOB" | jq -r .data.id)
EXEC_ID=$(echo "$JOB" | jq -r '.data.executions[0].id')

# 3) Poll
curl -s "$BASE_URL/api/v2/jobs/$JOB_ID" \
  -H "Authorization: Bearer $QROUTER_API_KEY" | jq .

# 4) Result when result_available
curl -s "$BASE_URL/api/v2/executions/$EXEC_ID/result" \
  -H "Authorization: Bearer $QROUTER_API_KEY" | jq .
```

**Note:** v2 needs the current `qrouter.sql` migrations applied (circuit and
execution-group tables). If those are missing, stick to v1 until an operator
applies the SQL.

---

## Path 3 — Your GitHub repo without the GitHub App

If `GITHUB_APP_*` is not configured (or `/dashboard/github` cannot connect):

1. Open the `.qasm` file in your repo.
2. Paste the source into **Path 2** (curl) or `/dashboard/submit`.
3. Or use the SDKs:

**TypeScript** (`sdk/typescript`):

```ts
import { QRouter } from "@qrouter/sdk";

const qrouter = new QRouter(process.env.QROUTER_API_KEY!);
const job = await qrouter.jobs.create({
  circuit: await readFile("bell.qasm", "utf8"),
  shots: 1024,
  target: "auto",
  routing_mode: "balanced",
  optimization_level: 2,
});
console.log(await qrouter.jobs.result((await qrouter.jobs.wait(job.id)).id));
```

**Python** (`sdk/python`):

```python
from qrouter import QRouter
import os

with QRouter(os.environ["QROUTER_API_KEY"]) as qrouter:
    with open("bell.qasm") as source:
        job = qrouter.create_job(source.read(), shots=1024, target="auto")
    print(qrouter.get_result(qrouter.wait(job["id"])["id"]))
```

Point the SDK base URL at `$BASE_URL` if you are not on the public default host
(see SDK client constructor / env docs in each package).

Public repos can sometimes be inspected with a server `GITHUB_TOKEN` fallback,
but private repos require the org’s GitHub App connection.

---

## Local demo key (dev only)

With **no** Supabase service configuration, `QROUTER_DEMO_MODE=true`, and
`NODE_ENV !== "production"`, the fixed key `qci_test_local_development` hits an
in-memory demo workspace. Production always rejects it. Prefer a real key from
`/dashboard/api-keys` against your configured deployment for a true end-to-end
test.

---

## If the first job fails

| Symptom | Likely cause |
|---------|----------------|
| `401` / authentication | Wrong/revoked key; or demo mode off with no Supabase service key |
| `402` / `insufficient_credits` | Buy credits at `/dashboard/billing` |
| `403` insufficient_scope | Key missing `jobs:write` / `jobs:read` |
| `403` test key + QPU target | Use `auto` / a simulator, or a live key |
| v2 500 / missing relation | `qrouter.sql` not applied yet |
| Job stays `queued` | Execution poller / scheduler not running on the deployment |
| Provider / transpile errors | Missing provider or simulator worker configuration on the host |
