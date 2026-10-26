# Experiment campaigns: rollout and boundaries

This change is an initial campaign product built on the existing circuit/job system. It does not establish customer demand, quantum advantage, or universal provider compatibility.

## Database and release order

1. Keep the existing legacy Supabase schema installed in its documented order. The versioned files in `supabase/migrations/` are incremental changes against that schema; they do not bootstrap an empty database.
2. Apply pending versioned migrations in filename order and retain their versions in Supabase migration history. The first restores the existing service-only RPC contract, and the next adds organization-scoped immutable experiment definitions, approved runs and circuit-release reference scrubbing. Missing storage returns an actionable 503; it never silently switches production to demo mode.
3. The billing migration adds the provider usage reconciliation summary, and the final migration covers the new foreign keys with indexes. Attempt/event billing evidence remains available independently of the optional summary table. No migration retroactively debits customers or changes previously accepted quotes. `supabase/experiments.sql` and `supabase/experiment-billing.sql` remain rerunnable schema snapshots, not a second migration history.
4. Deploy the matching app and compiler worker together. Worker results now identify their coordinate space explicitly; the new app should not rely on an old worker's ambiguous result semantics. Drain active work before rollout. Queued legacy index-priced jobs are rejected by the new dispatcher and need a fresh native-rate quote and approval.
5. Verify a small simulator campaign before enabling any externally billed backend. Do not merge solely because demo mode works: live persistence, authenticated advancement and credit reservation must be checked on the target deployment.

The campaign SQL is additive and rerunnable. Isolated PostgreSQL checks cover organization RLS, denied client mutations, release scrubbing, idempotency, foreign keys, cascades, nullable unknown provider costs, and Supabase's explicit default function grants.

## Production database rollout: 2026-10-26

Applied through the Supabase connector to the active **QCI** project (`xmimdalmovzxqiyyeipg`). The public qrouter.app client configuration was checked against this project before applying changes; the separate inactive project named QRouter was not the target.

| Version | Migration |
| --- | --- |
| `20261026113632` | `restore_service_only_rpc_permissions` |
| `20261026113737` | `experiments` |
| `20261026113754` | `experiment_billing` |
| `20261026113934` | `index_experiment_relationships` |

Production catalog checks confirmed all three tables, enabled RLS, organization-member SELECT policies, denied anonymous access and authenticated mutations, service-role access, the release trigger with a fixed search path, nullable unknown costs, and all three added relationship indexes. The 20 RPCs already designated service-only in the source now deny execution to both anonymous and authenticated roles while retaining service-role access. Revoking from PUBLIC alone had left Supabase's explicit role grants in place.

The isolated PostgreSQL suite passed 45 checks, including repeated application under explicit default grants. A read-only request through the authenticated QRouter CLI to the live experiments endpoint succeeded with an empty list. No provider jobs were submitted and no balances, quotes, ledger records or authentication settings were changed during this rollout. These checks do not establish a completed paid campaign on the updated deployment or deployment of the matching compiler worker.

The new objects have no security warnings or missing-foreign-key-index findings. Existing project advisories remain outside this migration; in particular, review the remaining [public security-definer function grants](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) and [Auth password protection setting](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) separately. New empty-table indexes are naturally reported as unused until traffic exercises them.

## Execution and approval

- Definitions bind objective, source hash, targets, shots, intent, reference provenance, acceptance criterion and the complete spending ceiling. Changes create a new version.
- Saving or previewing submits no provider execution. Running requires the saved definition hash, the exact ceiling and an idempotency key. The full execution group is repriced and checked before funding.
- Campaigns permit one attempt per target, with failover disabled. The existing single-job API may explicitly reserve a larger attempt allowance; it cannot silently exceed the accepted total.
- The console advances at most five active owned executions per refresh through the existing funded-job endpoint. An authenticated scheduler is still needed for unattended runs after the browser closes. The fleet endpoint must retain its scheduler secret.
- Retain the run's idempotency key after a network error. An interrupted submission may have created a group; replay the same key to recover instead of creating another paid run. Evidence distinguishes explicit pre-submission rejection from an unknown submission outcome.
- API-key read/write scopes apply to campaigns. Test keys remain simulator-only. Development demo principals are restricted to in-process local simulation, even if external provider environment variables are present.

## Native pricing

QCI is no longer a source of billing or execution decisions. External task/shot rate cards require `QROUTER_NATIVE_RATES_JSON` with source, observation time, expiry and the exact execution channel; see `.env.local.example`. Missing, expired and mismatched rates are unknown, never free.

IBM runtime pricing, Amazon SV1 runtime pricing and direct IonQ usage pricing are deliberately unavailable for paid quoting until bounded native usage-quote adapters are implemented. Adding an arbitrary per-shot number does not enable them. A configured credential is distinct from an eligible, priced and smoke-tested execution path.

Customer ledger charges, estimated provider use and confirmed provider invoices are distinct. Existing settlement caps the customer charge at the accepted quote and refunds failed/cancelled jobs. Unrecovered provider costs remain platform exposure in the reconciliation record; invoice import and an operator reconciliation workflow remain future work.

## Evidence scope

The initial criterion compares observed classical-bit counts with an author-supplied reference distribution using total variation distance and a conservative simultaneous Hoeffding bound over reference outcomes plus an aggregated other-outcome category. Confidence is per execution, assumes independent shots from a fixed distribution, and is not adjusted for repeated campaign runs or backend selection. Calibration drift is outside the interval's model.

Synthetic counts, invalid shot totals and incompatible result coordinates cannot establish sampling confidence. Outcomes can pass, fail or remain inconclusive. A passed distribution check does not certify algorithm correctness, business value or quantum advantage. Record-only experiments state that no acceptance claim was specified.

Exported evidence includes normalized results, source identity, compilation/quote context, criterion/provenance, costs or explicit unknowns, and SHA-256/JCS hashes of exported results. Circuit release scrubs author-supplied reference distributions alongside circuit artifacts. Independent native-format equivalence remains unsupported where no completed check exists.

## Commercial work still required

The software retains explicit execution fees and prepaid credits. Customer-owned provider accounts, separate campaign-service billing, subscriptions, customer-specific approval roles, automated regression campaigns, public benchmark imports and domain-specific problem formulation are not launched by this change. Use the paid-pilot and abandonment gates in `PRODUCT-ROADMAP.md` before expanding those commitments.
