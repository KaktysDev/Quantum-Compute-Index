# Product direction and commercial validation

Status: implementation direction, not evidence of customer demand. No interviews, paid pilots, renewals, or measured commercial savings are claimed here.

## Product and initial buyer

QRouter helps a small technical team turn a quantum experiment into a budget-approved, reproducible evidence record. The initial buyer hypothesis is the technical lead at a quantum software/application company that repeatedly delivers customer proof-of-concept projects using more than one provider.

The purchased outcome should be less integration/reporting work and more reviewable customer decisions. A unified API, AI conversation, device catalog, or global index is not sufficient differentiation. Existing tools already cover much of that surface:

- [Braket](https://aws.amazon.com/braket/): common development tools and managed multi-provider execution.
- [qBraid](https://docs.qbraid.com/v2/api-reference/rest/get-quantum-jobs-cost-estimate): provider access, credit estimates, and execution lifecycle.
- [SupermarQ](https://superstaq.readthedocs.io/en/stable/apps/supermarq/examples/examples.html): scalable application benchmark definitions and scores.
- [Metriq](https://unitary.foundation/posts/2026_metriq_platform/): reproducible cross-provider benchmarks, longitudinal data, and public presentation.

Customer-owned private experiments, explicit approval, spend reconciliation, review and delivery are the proposed focus. Public benchmark suites should be integrated where useful rather than recreated. The strongest competitor may be the customer's existing notebook, scripts and spreadsheet.

## Current implementation boundary

- An experiment campaign records objective, reusable circuit, reference/criterion, targets, shots, execution intent and accepted budget.
- Run approval precedes execution. Simulation and hardware are distinct intents.
- Quotes use dated native pricing, explicit software fees and permitted attempt budgets.
- Result assessments preserve uncertainty and allow inconclusive outcomes. Completion does not establish scientific correctness or quantum advantage.
- Existing circuit, job, artifact and report resources support the campaign workflow.
- The research index remains separate from job quoting and workload execution decisions.

Production readiness still depends on database migrations, configured integrations, operator rate provenance and credentialed smoke verification. A UI feature is not proof that all providers or commercial operations are enabled.

## Implementation sequence

1. **Reliable core workflow:** enforce tenant scope, immutable experiment definitions, explicit approval, atomic funding, all-in budget checks, execution intent, deterministic result decoding and release behavior. Verify with simulator fixtures and controlled provider smoke runs.
2. **Evidence quality:** store source and compilation identities, execution settings, native rate provenance, device/calibration context when available, raw result counts, reference provenance, uncertainty and assessment method/version. Distinguish missing observations from zero values.
3. **Cost reconciliation:** separate estimates, reported usage, reserved amounts, actual provider charges and customer settlement. Capture retry costs and costs incurred by failed/cancelled jobs. Reconcile against provider invoices before expanding compute resale.
4. **Customer workflow:** test review/approval ownership, side-by-side comparison of customer-defined experiments, report export and integration with existing CI tools. Do not imply automated statistical regression checks until methods and false-positive behavior are validated.
5. **Commercial operation:** validate the buyer and repeat use before adding subscriptions, service-level commitments, broad provider coverage or private deployment packages.

Initially keep the provider set small and verified. Expand only when a buyer's actual workflow requires another provider and the execution, encoding, price and result semantics can all be supported.

## Commercial model hypotheses

The existing product charges explicit per-execution software fees through prepaid credits. These fees are implemented; a sustainable margin is not established. An 8% markup on $10,000 of provider spend produces $800 before payment processing, infrastructure, compilation, AI calls, support and unrecovered execution liabilities. This is arithmetic, not an actual operating result.

Test a paid, scoped 2–4 week experiment campaign before assuming monthly subscription demand. Agree on the question, deliverable, support boundary and provider spend separately. Do not publish arbitrary package prices as validated market pricing.

A customer-owned-provider-account mode with a separate software/service fee is a future commercial option, not a currently advertised capability. It may avoid tying software revenue to provider spend and reduce resale exposure; supplier terms, accounting and operational requirements still need review before such a mode launches.

Only offer ongoing workspace pricing after customers repeat campaigns often enough to benefit. Do not assume episodic quantum R&D needs a monthly subscription.

## Validation and abandonment gates

1. Interview 12–15 qualified teams about their last three real campaigns, bills, reports and recurring failure points. Identify the budget owner and current workaround.
2. Find at least three teams with recurring paid experiments and the same costly workflow problem. Free/educational interest alone does not validate this buyer.
3. Secure three paid, scoped pilots around substantially the same essential workflow.
4. Measure customer value against the fee: avoided engineering/reporting work, prevented wasted runs, or a materially improved decision. Record baseline and evidence rather than collecting compliments.
5. Seek a second campaign or renewal from at least two pilot customers within 60–90 days. A paid initial evaluation is not recurring revenue validation.
6. Stop the subscription plan if campaigns do not repeat, the buyer has no budget, or existing scripts already solve the problem. Keep a bounded service only if its economics work; otherwise change the buyer/problem or stop.

These are proposed decision rules, not completed milestones.

## Role of the index

The index is secondary research, with published assumptions and limited coverage. Its capability and production-cost models are not operator invoices or workload-success measurements. Keep provenance, source dates, rates and device observations useful to experiments; do not require customers to understand a global score to understand a quote.

Continue public index work only if it serves a demonstrated research audience or brings qualified demand at a reasonable maintenance cost. Do not assume that a proprietary global dataset or financial market will emerge from private customer experiments. Customer permission, comparability, sampling bias and hardware changes constrain any aggregate use.
