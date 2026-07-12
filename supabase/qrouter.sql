-- QRouter control-plane migration. Run after supabase/schema.sql.
create extension if not exists pgcrypto;

alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists company text;
alter table public.profiles add column if not exists stripe_customer_id text;
alter table public.profiles add column if not exists billing_setup_complete boolean not null default false;
alter table public.profiles add column if not exists onboarding_complete boolean not null default false;
alter table public.profiles add column if not exists preferences jsonb not null default '{}';

-- Infrastructure credentials are service-role only.
drop policy if exists "provider_keys: authenticated all" on public.provider_keys;
drop trigger if exists on_auth_user_created_allowlist on auth.users;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique,
  created_by uuid not null references auth.users(id), stripe_customer_id text,
  billing_setup_complete boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check(role in('owner','admin','developer','billing','member')),
  created_at timestamptz not null default now(), primary key(organization_id,user_id)
);
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
create or replace function public.is_org_member(org_id uuid) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.organization_members where organization_id=org_id and user_id=auth.uid())$$;
create or replace function public.is_org_admin(org_id uuid) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.organization_members where organization_id=org_id and user_id=auth.uid() and role in('owner','admin'))$$;
drop policy if exists "org member read" on public.organizations; create policy "org member read" on public.organizations for select using(public.is_org_member(id));
drop policy if exists "org admin update" on public.organizations; create policy "org admin update" on public.organizations for update using(public.is_org_admin(id));
drop policy if exists "membership read" on public.organization_members; create policy "membership read" on public.organization_members for select using(public.is_org_member(organization_id));

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null, name text not null, key_prefix text not null unique,
  key_hash text not null unique, environment text not null default 'live' check(environment in('test','live')),
  scopes text[] not null default array['jobs:read','jobs:write'], last_used_at timestamptz,
  expires_at timestamptz, revoked_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists api_keys_org_idx on public.api_keys(organization_id,created_at desc);
alter table public.api_keys enable row level security;
drop policy if exists "api key member read" on public.api_keys; create policy "api key member read" on public.api_keys for select using(public.is_org_member(organization_id));
drop policy if exists "api key admin write" on public.api_keys; create policy "api key admin write" on public.api_keys for all using(public.is_org_admin(organization_id)) with check(public.is_org_admin(organization_id));

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null, api_key_id uuid references public.api_keys(id) on delete set null,
  idempotency_key text, name text, input_format text not null check(input_format in('openqasm2','openqasm3')),
  source text not null, source_hash text not null, shots integer not null default 1024 check(shots between 1 and 1000000),
  target text not null default 'auto', routing_mode text not null default 'balanced' check(routing_mode in('balanced','cost','speed','quality')),
  constraints jsonb not null default '{}', analysis jsonb, route_decision jsonb,
  status text not null default 'created' check(status in('created','analyzing','quoted','awaiting_payment','funds_reserved','queued','submitted','processing','completed','failed','cancellation_requested','cancelled')),
  selected_backend_id text, provider_job_id text, result jsonb, error jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  started_at timestamptz, completed_at timestamptz, unique(organization_id,idempotency_key)
);
create index if not exists jobs_org_created_idx on public.jobs(organization_id,created_at desc);
create index if not exists jobs_status_idx on public.jobs(status,updated_at);
alter table public.jobs enable row level security;
drop policy if exists "job member read" on public.jobs; create policy "job member read" on public.jobs for select using(public.is_org_member(organization_id));
drop policy if exists "job member create" on public.jobs; create policy "job member create" on public.jobs for insert with check(public.is_org_member(organization_id));

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(), job_id uuid not null unique references public.jobs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade, currency text not null default 'usd',
  provider_cost numeric(14,6) not null, transpiler_fee numeric(14,6) not null, platform_fee numeric(14,6) not null,
  total numeric(14,6) not null, qci_snapshot_id bigint references public.qci_snapshots(id), rate_snapshot jsonb not null,
  expires_at timestamptz not null, accepted_at timestamptz, created_at timestamptz not null default now()
);
alter table public.quotes enable row level security;
drop policy if exists "quote member read" on public.quotes; create policy "quote member read" on public.quotes for select using(public.is_org_member(organization_id));

create table if not exists public.job_attempts (
  id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id) on delete cascade,
  attempt integer not null, backend_id text not null, provider_job_id text, status text not null,
  request jsonb, response jsonb, error jsonb, started_at timestamptz not null default now(), finished_at timestamptz,
  unique(job_id,attempt)
);
create table if not exists public.job_events (
  id bigint generated always as identity primary key, job_id uuid not null references public.jobs(id) on delete cascade,
  type text not null, from_status text, to_status text, payload jsonb not null default '{}', created_at timestamptz not null default now()
);
create index if not exists job_events_job_idx on public.job_events(job_id,id);
alter table public.job_attempts enable row level security; alter table public.job_events enable row level security;
drop policy if exists "attempt member read" on public.job_attempts; create policy "attempt member read" on public.job_attempts for select using(exists(select 1 from public.jobs where id=job_id and public.is_org_member(organization_id)));
drop policy if exists "event member read" on public.job_events; create policy "event member read" on public.job_events for select using(exists(select 1 from public.jobs where id=job_id and public.is_org_member(organization_id)));

create table if not exists public.artifacts (
  id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check(kind in('source','transpiled','result')), storage_path text not null,
  content_type text not null, size_bytes bigint, sha256 text, encrypted boolean not null default true,
  created_at timestamptz not null default now(), unique(job_id,kind)
);
alter table public.artifacts enable row level security;
drop policy if exists "artifact member read" on public.artifacts; create policy "artifact member read" on public.artifacts for select using(public.is_org_member(organization_id));

create table if not exists public.credit_accounts (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  currency text not null default 'usd', available numeric(14,6) not null default 0,
  reserved numeric(14,6) not null default 0, updated_at timestamptz not null default now(), check(available>=0 and reserved>=0)
);
create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null, type text not null check(type in('purchase','reserve','release','charge','refund','adjustment')),
  amount numeric(14,6) not null, balance_after numeric(14,6) not null, external_id text,
  metadata jsonb not null default '{}', created_at timestamptz not null default now()
);
create unique index if not exists ledger_external_unique on public.ledger_entries(external_id) where external_id is not null;
alter table public.credit_accounts enable row level security; alter table public.ledger_entries enable row level security;
drop policy if exists "credit member read" on public.credit_accounts; create policy "credit member read" on public.credit_accounts for select using(public.is_org_member(organization_id));
drop policy if exists "ledger member read" on public.ledger_entries; create policy "ledger member read" on public.ledger_entries for select using(public.is_org_member(organization_id));

create or replace function public.reserve_job_credits(p_job_id uuid,p_amount numeric) returns void language plpgsql security definer set search_path=public as $$declare o uuid;b numeric;begin select organization_id into o from public.jobs where id=p_job_id;select available into b from public.credit_accounts where organization_id=o for update;if b is null or b<p_amount then raise exception 'insufficient_credits';end if;update public.credit_accounts set available=available-p_amount,reserved=reserved+p_amount,updated_at=now() where organization_id=o;insert into public.ledger_entries(organization_id,job_id,type,amount,balance_after)values(o,p_job_id,'reserve',-p_amount,b-p_amount);end$$;
create or replace function public.settle_job_credits(p_job_id uuid,p_reserved numeric,p_actual numeric) returns void language plpgsql security definer set search_path=public as $$declare o uuid;b numeric;begin select organization_id into o from public.jobs where id=p_job_id;update public.credit_accounts set available=available+greatest(p_reserved-p_actual,0),reserved=greatest(reserved-p_reserved,0),updated_at=now() where organization_id=o returning available into b;insert into public.ledger_entries(organization_id,job_id,type,amount,balance_after)values(o,p_job_id,'charge',-p_actual,b);end$$;
create or replace function public.release_job_credits(p_job_id uuid,p_amount numeric) returns void language plpgsql security definer set search_path=public as $$declare o uuid;b numeric;begin select organization_id into o from public.jobs where id=p_job_id;update public.credit_accounts set available=available+p_amount,reserved=greatest(reserved-p_amount,0),updated_at=now() where organization_id=o returning available into b;insert into public.ledger_entries(organization_id,job_id,type,amount,balance_after)values(o,p_job_id,'release',p_amount,b);end$$;
create or replace function public.add_credits(p_organization_id uuid,p_amount numeric,p_external_id text,p_metadata jsonb default '{}') returns void language plpgsql security definer set search_path=public as $$declare b numeric;begin if exists(select 1 from public.ledger_entries where external_id=p_external_id)then return;end if;update public.credit_accounts set available=available+p_amount,updated_at=now() where organization_id=p_organization_id returning available into b;insert into public.ledger_entries(organization_id,type,amount,balance_after,external_id,metadata)values(p_organization_id,'purchase',p_amount,b,p_external_id,p_metadata);end$$;

create table if not exists public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  url text not null, signing_secret_encrypted text not null, enabled boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.webhook_endpoints enable row level security;
drop policy if exists "webhook admin" on public.webhook_endpoints; create policy "webhook admin" on public.webhook_endpoints for all using(public.is_org_admin(organization_id)) with check(public.is_org_admin(organization_id));

create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(), endpoint_id uuid not null references public.webhook_endpoints(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade, event_type text not null, response_status integer,
  error text, delivered_at timestamptz, created_at timestamptz not null default now()
);
alter table public.webhook_deliveries enable row level security;
drop policy if exists "delivery member read" on public.webhook_deliveries;
create policy "delivery member read" on public.webhook_deliveries for select using(exists(select 1 from public.webhook_endpoints where id=endpoint_id and public.is_org_member(organization_id)));

create table if not exists public.api_rate_windows (
  api_key_id uuid not null references public.api_keys(id) on delete cascade,
  window_start timestamptz not null, request_count integer not null default 0,
  primary key(api_key_id,window_start)
);
alter table public.api_rate_windows enable row level security;
create or replace function public.consume_api_rate_limit(p_api_key_id uuid,p_limit integer default 120)
returns boolean language plpgsql security definer set search_path=public as $$declare w timestamptz;c integer;begin
  w=date_trunc('minute',now());
  insert into public.api_rate_windows(api_key_id,window_start,request_count) values(p_api_key_id,w,1)
  on conflict(api_key_id,window_start) do update set request_count=public.api_rate_windows.request_count+1
  returning request_count into c;
  delete from public.api_rate_windows where window_start<now()-interval '10 minutes';
  return c<=p_limit;
end$$;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$declare o uuid;begin insert into public.profiles(id,email,full_name)values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',split_part(coalesce(new.email,''),'@',1)))on conflict(id)do nothing;insert into public.organizations(name,slug,created_by)values(coalesce(new.raw_user_meta_data->>'full_name','Personal')||'''s workspace','ws-'||replace(new.id::text,'-',''),new.id)returning id into o;insert into public.organization_members values(o,new.id,'owner',now());insert into public.credit_accounts(organization_id,available)values(o,10);return new;end$$;

-- Backfill workspaces for accounts created by the original private QCI app.
do $$declare p record;o uuid;begin
  for p in select profiles.id,profiles.email from public.profiles where not exists(select 1 from public.organization_members where user_id=profiles.id)
  loop
    insert into public.organizations(name,slug,created_by) values(coalesce(split_part(p.email,'@',1),'Personal')||'''s workspace','ws-'||replace(p.id::text,'-',''),p.id) returning id into o;
    insert into public.organization_members(organization_id,user_id,role) values(o,p.id,'owner');
    insert into public.credit_accounts(organization_id,available) values(o,10);
  end loop;
end$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('qrouter-artifacts','qrouter-artifacts',false,10485760,array['text/plain','application/json']) on conflict(id)do nothing;
drop policy if exists "artifact object read" on storage.objects;
create policy "artifact object read" on storage.objects for select to authenticated using(bucket_id='qrouter-artifacts' and public.is_org_member(((storage.foldername(name))[1])::uuid));
