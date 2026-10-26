-- Apply AFTER qrouter.sql. Additive; no production data is modified on install.
begin;
create table if not exists public.experiments (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  circuit_id uuid generated always as ((definition ->> 'circuit_id')::uuid) stored,
  version integer not null check (version > 0),
  definition jsonb not null,
  definition_hash text not null check (definition_hash ~ '^[a-f0-9]{64}$'),
  source_hash text not null,
  idempotency_key text not null,
  request_hash text not null,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  foreign key (circuit_id) references public.circuits(id) on delete cascade,
  unique (organization_id, idempotency_key)
);
create table if not exists public.experiment_runs (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  experiment_id uuid not null references public.experiments(id) on delete cascade,
  group_id uuid references public.execution_groups(id) on delete set null,
  approved_definition_hash text not null,
  approved_max_total_cost numeric not null check (approved_max_total_cost > 0),
  idempotency_key text not null,
  request_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  preparation_status text not null default 'preparing' check (preparation_status in ('preparing','not_submitted','accepted')),
  preparation_error jsonb,
  unique (organization_id, idempotency_key)
);
alter table public.experiment_runs add column if not exists updated_at timestamptz not null default now();
alter table public.experiment_runs add column if not exists preparation_status text not null default 'preparing' check (preparation_status in ('preparing','not_submitted','accepted'));
alter table public.experiment_runs add column if not exists preparation_error jsonb;
create index if not exists experiments_org_created on public.experiments(organization_id, created_at desc);
create index if not exists experiment_runs_experiment on public.experiment_runs(experiment_id, created_at desc);
alter table public.experiments enable row level security;
alter table public.experiment_runs enable row level security;
drop policy if exists "experiment member read" on public.experiments;
create policy "experiment member read" on public.experiments for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists "experiment run member read" on public.experiment_runs;
create policy "experiment run member read" on public.experiment_runs for select to authenticated using (public.is_org_member(organization_id));
revoke all on public.experiments, public.experiment_runs from anon, authenticated;
grant select on public.experiments, public.experiment_runs to authenticated;
grant all on public.experiments, public.experiment_runs to service_role;

-- Preserve the identity of a released campaign, while purging author-supplied
-- reference data alongside the circuit's other source-derived artifacts.
create or replace function public.release_experiment_reference() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.released_at is not null and old.released_at is null then
    update public.experiments set released_at=new.released_at,
      definition=jsonb_set(jsonb_set(definition, '{reference}', '{"kind":"none","reason":"Circuit data was released."}'::jsonb), '{success_criterion}', '{"metric":"record_only"}'::jsonb)
      where circuit_id=new.id;
  end if;
  return new;
end $$;
drop trigger if exists release_experiment_reference on public.circuits;
create trigger release_experiment_reference after update of released_at on public.circuits for each row execute function public.release_experiment_reference();
revoke all on function public.release_experiment_reference() from public, anon, authenticated;
commit;
