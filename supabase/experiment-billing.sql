-- Apply manually after review. Adds a durable provider-usage audit without
-- changing previously accepted quotes or increasing any customer charge.
begin;
create table if not exists public.provider_usage_reconciliation (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  status text not null check(status in ('pending','confirmed')),
  estimated_provider_cost numeric check(estimated_provider_cost >= 0),
  actual_provider_cost numeric check(actual_provider_cost >= 0),
  accepted_total numeric not null check(accepted_total >= 0),
  customer_charge_ceiling numeric not null check(customer_charge_ceiling >= 0),
  evidence jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  check ((status = 'pending' and actual_provider_cost is null)
      or (status = 'confirmed' and actual_provider_cost is not null)),
  check (customer_charge_ceiling <= accepted_total)
);
create index if not exists provider_usage_org_idx on public.provider_usage_reconciliation(organization_id);
alter table public.provider_usage_reconciliation enable row level security;
drop policy if exists provider_usage_org_read on public.provider_usage_reconciliation;
create policy provider_usage_org_read on public.provider_usage_reconciliation for select to authenticated
  using (public.is_org_member(organization_id));
revoke all on public.provider_usage_reconciliation from anon, authenticated;
grant select on public.provider_usage_reconciliation to authenticated;
grant all on public.provider_usage_reconciliation to service_role;
commit;

-- Existing finalize_qrouter_job caps completed charges at the accepted quote
-- and releases reservations for failed/cancelled jobs. Unconfirmed external
-- costs are intentionally recorded as platform exposure, never guessed to be
-- zero and never silently debited from a customer later. Pending records require
-- provider invoice/usage reconciliation before another paid attempt is allowed.
