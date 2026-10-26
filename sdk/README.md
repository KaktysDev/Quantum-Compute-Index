# QRouter SDKs: experiment campaigns

`QRouterV2` exposes immutable experiment definitions, cost previews, explicit run approvals, and result evidence. Existing circuit, job, and execution methods remain available. Use your existing workspace key and base URL; the clients do not persist credentials.

| Operation | TypeScript | Python |
| --- | --- | --- |
| List definitions | `client.experiments.list()` | `client.list_experiments()` |
| Create definition | `client.experiments.create(definition, key)` | `client.create_experiment(definition, idempotency_key=key)` |
| Read definition and evidence | `client.experiments.get(id)` | `client.get_experiment(id)` |
| Preview complete cost | `client.experiments.quote(id)` | `client.quote_experiment(id)` |
| Submit explicit approval | `client.experiments.run(id, approval, key)` | `client.run_experiment(id, approved_definition_hash=hash, approved_max_total_cost=ceiling, idempotency_key=key)` |

All methods unwrap the API's `data` field. Quote calls submit no provider jobs. Run methods are thin wrappers: the caller must review the definition, target plan, preview, and ceiling before supplying approval. They do not automatically approve a preview or wait for execution.

## TypeScript

```ts
import { QRouterV2 } from "@qrouter/sdk";

const client = new QRouterV2(process.env.QROUTER_API_KEY!);
const evidence = await client.experiments.get(experimentId);
const preview = await client.experiments.quote(experimentId);

// Application-specific review/approval happens here. Do not auto-approve this
// response in an unattended workflow merely because it is within a budget.
const definition = evidence.experiment;
if (preview.definition_hash !== definition.definition_hash || !preview.within_budget) {
  throw new Error("Review a fresh campaign preview before approval.");
}

// Supply these only after the user or your authorized workflow approves them.
const outcome = await client.experiments.run(experimentId, {
  approved_definition_hash: approvedDefinitionHash,
  approved_max_total_cost: approvedCampaignCeiling,
}, runIdempotencyKey);
```

## Python

```python
from qrouter import QRouterV2

with QRouterV2(api_key) as client:
    evidence = client.get_experiment(experiment_id)
    preview = client.quote_experiment(experiment_id)
    # Review the question, reference, criterion, targets, intent, and total.
    # Then pass explicitly approved values, rather than approving implicitly.
    outcome = client.run_experiment(
        experiment_id,
        approved_definition_hash=approved_definition_hash,
        approved_max_total_cost=approved_campaign_ceiling,
        idempotency_key=run_idempotency_key,
    )
```

## Definition input

A definition includes `name`, `objective`, reusable `circuit_id`, `execution_intent` (`simulate` or `hardware`), unique `targets`, `shots`, and `max_total_cost`. Add either a reference distribution with provenance or an explicit reason why none exists. A distribution criterion uses `total_variation_distance`, `max_distance`, and `confidence`; otherwise use `record_only`. Create a new definition, optionally naming `previous_version_id`, to change the question or execution plan.

Creation and run requests use idempotency keys. Retain the key for the logical operation and reuse it after timeouts; generating another key can create another definition or run. SDKs generate a key when omitted, but applications that need recovery should supply and retain their own.

The approved hash and ceiling must exactly match the immutable definition. The server recalculates estimates and enforces the complete campaign ceiling before reserving credits. A run response with HTTP 402 still contains an accepted, parked run; both SDKs return its data with `outcome: "awaiting_payment"` so the application can retain its identifiers. Other API errors remain errors.

Evidence includes execution state, result assessments and their limitations. Missing results or costs remain unknown. Neither a completed job nor a passed criterion establishes quantum advantage or business value.
