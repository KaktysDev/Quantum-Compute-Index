-- Cover circuit-release, group deletion and organization-scoped reconciliation.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create index if not exists experiments_circuit_idx on public.experiments(circuit_id);
create index if not exists experiment_runs_group_idx on public.experiment_runs(group_id);
create index if not exists provider_usage_org_idx on public.provider_usage_reconciliation(organization_id);
commit;
