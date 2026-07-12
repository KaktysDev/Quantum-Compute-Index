-- ════════════════════════════════════════════════════════════════════════════
-- QuantumForge Exchange — Supabase schema
-- ────────────────────────────────────────────────────────────────────────────
-- HOW TO USE:
--   1. Open your Supabase project → SQL Editor → New query.
--   2. Paste this entire file and click "Run".
--   3. Add the people allowed to sign in (bottom of this file / Table Editor):
--        insert into public.allowed_emails (email) values ('you@example.com');
--   4. In Authentication → Providers, enable Google (see README).
-- Safe to re-run: uses "if not exists" / "create or replace" / "drop ... if exists".
-- ════════════════════════════════════════════════════════════════════════════

-- ── Extensions ──────────────────────────────────────────────────────────────
create extension if not exists pgcrypto;

-- ── 1. Allowlist ────────────────────────────────────────────────────────────
-- Only emails in this table may create an account / sign in.
create table if not exists public.allowed_emails (
  email      text primary key,
  added_by   text,
  created_at timestamptz not null default now()
);
alter table public.allowed_emails enable row level security;
-- No policies → unreadable by anon/authenticated. Only the service role (cron,
-- server) and the Supabase dashboard can see/manage the list.

-- ── 2. Profiles ─────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  full_name  text,
  company    text,
  stripe_customer_id text,
  billing_setup_complete boolean not null default false,
  onboarding_complete boolean not null default false,
  role       text not null default 'member',
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists company text;
alter table public.profiles add column if not exists stripe_customer_id text;
alter table public.profiles add column if not exists billing_setup_complete boolean not null default false;
alter table public.profiles add column if not exists onboarding_complete boolean not null default false;
alter table public.profiles enable row level security;

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = id);

-- ── 3. Provider API keys ────────────────────────────────────────────────────
-- encrypted_key is AES-256-GCM ciphertext (see src/lib/crypto.ts). The raw key
-- is never returned to the browser; decryption happens only server-side (cron).
create table if not exists public.provider_keys (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null unique,
  encrypted_key text not null,
  label        text,
  enabled      boolean not null default true,
  updated_by   uuid references auth.users (id),
  updated_at   timestamptz not null default now()
);
alter table public.provider_keys enable row level security;

-- Provider credentials are infrastructure secrets. Only service-role code may
-- read or mutate this table.
drop policy if exists "provider_keys: authenticated all" on public.provider_keys;

-- ── 4. QCI snapshots (the index history) ────────────────────────────────────
create table if not exists public.qci_snapshots (
  id         bigint generated always as identity primary key,
  ts         timestamptz not null,
  price      numeric not null,
  change_pct numeric not null default 0,
  vwap       numeric,
  components jsonb,
  source     text not null default 'sample',  -- 'live' | 'sample'
  created_at timestamptz not null default now()
);
create index if not exists qci_snapshots_ts_idx on public.qci_snapshots (ts desc);
alter table public.qci_snapshots enable row level security;

-- Public read: the landing page shows the price without login.
drop policy if exists "qci_snapshots: public read" on public.qci_snapshots;
create policy "qci_snapshots: public read"
  on public.qci_snapshots for select
  to anon, authenticated
  using (true);
-- Inserts happen only via the service role (cron) → no insert policy needed.

-- ── 5. Provider metrics (raw inputs per refresh) ────────────────────────────
create table if not exists public.provider_metrics (
  id            bigint generated always as identity primary key,
  snapshot_ts   timestamptz not null,
  provider      text,
  qpu           text,
  price_per_nqh numeric,
  qv            numeric,
  clops         numeric,
  fid_2q        numeric,
  queue_seconds numeric,
  pqf           numeric,
  raw           jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists provider_metrics_ts_idx on public.provider_metrics (snapshot_ts desc);
alter table public.provider_metrics enable row level security;

drop policy if exists "provider_metrics: authenticated read" on public.provider_metrics;
create policy "provider_metrics: authenticated read"
  on public.provider_metrics for select
  to authenticated
  using (true);

-- ── 6. Allowlist enforcement trigger ────────────────────────────────────────
-- Blocks account creation for any email not on the allowlist. The OAuth attempt
-- fails and the app routes the user to /access-denied.
create or replace function public.enforce_email_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.allowed_emails ae
    where lower(ae.email) = lower(new.email)
  ) then
    raise exception 'Email % is not authorized for QuantumForge Exchange', new.email
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_allowlist on auth.users;
create trigger on_auth_user_created_allowlist
  before insert on auth.users
  for each row execute function public.enforce_email_allowlist();

-- ── 7. Auto-create a profile row on signup ──────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 8. Contact form ("Request access") + notification inbox ─────────────────
-- Public visitors submit the form (written via the service role). Only the
-- specific accounts listed in contact_viewers can READ the submissions.
create table if not exists public.contact_submissions (
  id         bigint generated always as identity primary key,
  name       text not null,
  email      text not null,
  phone      text not null,
  message    text not null,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists contact_submissions_created_idx on public.contact_submissions (created_at desc);
alter table public.contact_submissions enable row level security;

-- Hardcoded allowlist of who can see the contact inbox (NOT every dashboard user).
create table if not exists public.contact_viewers (
  email      text primary key,
  added_by   text,
  created_at timestamptz not null default now()
);
alter table public.contact_viewers enable row level security;
-- No policies → unreadable except via the function below / service role.

-- Is the current signed-in user allowed to see contact submissions?
create or replace function public.is_contact_viewer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.contact_viewers cv
    where lower(cv.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

drop policy if exists "contact: viewers read" on public.contact_submissions;
create policy "contact: viewers read"
  on public.contact_submissions for select
  to authenticated
  using (public.is_contact_viewer());

drop policy if exists "contact: viewers update" on public.contact_submissions;
create policy "contact: viewers update"
  on public.contact_submissions for update
  to authenticated
  using (public.is_contact_viewer())
  with check (public.is_contact_viewer());
-- Inserts come only from the server (service role), so no insert policy is needed.

-- ════════════════════════════════════════════════════════════════════════════
-- 9. WHO CAN SEE CONTACT FORM SUBMISSIONS  (hardcode the Google accounts here)
-- ════════════════════════════════════════════════════════════════════════════
-- insert into public.contact_viewers (email, added_by) values
--   ('founder@gmail.com', 'setup'),
--   ('partner@gmail.com', 'setup')
-- on conflict (email) do nothing;

-- ============================================================================
-- QRouter control plane
-- ============================================================================

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid not null references auth.users(id) on delete restrict,
  stripe_customer_id text,
  billing_setup_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.organizations enable row level security;

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'developer', 'billing', 'member')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
alter table public.organization_members enable row level security;

create or replace function public.is_org_member(org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.organization_members m where m.organization_id = org_id and m.user_id = auth.uid());
$$;

create or replace function public.is_org_admin(org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.organization_members m where m.organization_id = org_id and m.user_id = auth.uid() and m.role in ('owner','admin'));
$$;

drop policy if exists "organizations: member read" on public.organizations;
create policy "organizations: member read" on public.organizations for select using (public.is_org_member(id));
drop policy if exists "organizations: admin update" on public.organizations;
create policy "organizations: admin update" on public.organizations for update using (public.is_org_admin(id));
drop policy if exists "members: member read" on public.organization_members;
create policy "members: member read" on public.organization_members for select using (public.is_org_member(organization_id));

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  name text not null,
  key_prefix text not null unique,
  key_hash text not null unique,
  environment text not null default 'live' check (environment in ('test','live')),
  scopes text[] not null default array['jobs:read','jobs:write'],
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists api_keys_org_idx on public.api_keys(organization_id, created_at desc);
alter table public.api_keys enable row level security;
drop policy if exists "api_keys: member read" on public.api_keys;
create policy "api_keys: member read" on public.api_keys for select using (public.is_org_member(organization_id));
drop policy if exists "api_keys: admin write" on public.api_keys;
create policy "api_keys: admin write" on public.api_keys for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

create table if not exists public.backends (
  id text primary key,
  provider text not null,
  display_name text not null,
  kind text not null check (kind in ('qpu','simulator')),
  status text not null default 'online' check (status in ('online','degraded','offline')),
  qubits integer not null,
  native_gates text[] not null default '{}',
  queue_seconds integer not null default 0,
  fidelity numeric,
  reliability numeric not null default 0.99,
  price_per_shot numeric not null default 0,
  price_per_task numeric not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.backends enable row level security;
drop policy if exists "backends: public read" on public.backends;
create policy "backends: public read" on public.backends for select to anon, authenticated using (true);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  api_key_id uuid references public.api_keys(id) on delete set null,
  idempotency_key text,
  name text,
  input_format text not null check (input_format in ('openqasm2','openqasm3')),
  source text not null,
  source_hash text not null,
  shots integer not null default 1024 check (shots between 1 and 1000000),
  target text not null default 'auto',
  routing_mode text not null default 'balanced' check (routing_mode in ('balanced','cost','speed','quality')),
  constraints jsonb not null default '{}'::jsonb,
  analysis jsonb,
  route_decision jsonb,
  status text not null default 'created' check (status in ('created','analyzing','quoted','awaiting_payment','funds_reserved','queued','submitted','processing','completed','failed','cancellation_requested','cancelled')),
  selected_backend_id text references public.backends(id),
  provider_job_id text,
  quote_id uuid,
  result jsonb,
  error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique(organization_id, idempotency_key)
);
create index if not exists jobs_org_created_idx on public.jobs(organization_id, created_at desc);
create index if not exists jobs_status_idx on public.jobs(status, updated_at);
alter table public.jobs enable row level security;
drop policy if exists "jobs: member read" on public.jobs;
create policy "jobs: member read" on public.jobs for select using (public.is_org_member(organization_id));
drop policy if exists "jobs: member create" on public.jobs;
create policy "jobs: member create" on public.jobs for insert with check (public.is_org_member(organization_id));

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.jobs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  currency text not null default 'usd',
  provider_cost numeric(12,6) not null,
  transpiler_fee numeric(12,6) not null,
  platform_fee numeric(12,6) not null,
  total numeric(12,6) not null,
  qci_snapshot_id bigint references public.qci_snapshots(id),
  rate_snapshot jsonb not null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.jobs drop constraint if exists jobs_quote_id_fkey;
alter table public.jobs add constraint jobs_quote_id_fkey foreign key (quote_id) references public.quotes(id) deferrable initially deferred;
alter table public.quotes enable row level security;
drop policy if exists "quotes: member read" on public.quotes;
create policy "quotes: member read" on public.quotes for select using (public.is_org_member(organization_id));

create table if not exists public.job_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  attempt integer not null,
  backend_id text not null references public.backends(id),
  provider_job_id text,
  status text not null,
  request jsonb,
  response jsonb,
  error jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique(job_id, attempt)
);
alter table public.job_attempts enable row level security;
drop policy if exists "attempts: member read" on public.job_attempts;
create policy "attempts: member read" on public.job_attempts for select using (exists(select 1 from public.jobs j where j.id = job_id and public.is_org_member(j.organization_id)));

create table if not exists public.job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.jobs(id) on delete cascade,
  type text not null,
  from_status text,
  to_status text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists job_events_job_idx on public.job_events(job_id, id);
alter table public.job_events enable row level security;
drop policy if exists "events: member read" on public.job_events;
create policy "events: member read" on public.job_events for select using (exists(select 1 from public.jobs j where j.id = job_id and public.is_org_member(j.organization_id)));

create table if not exists public.credit_accounts (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  currency text not null default 'usd',
  available numeric(14,6) not null default 0,
  reserved numeric(14,6) not null default 0,
  updated_at timestamptz not null default now(),
  check (available >= 0 and reserved >= 0)
);
alter table public.credit_accounts enable row level security;
drop policy if exists "credits: member read" on public.credit_accounts;
create policy "credits: member read" on public.credit_accounts for select using (public.is_org_member(organization_id));

create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  type text not null check (type in ('purchase','reserve','release','charge','refund','adjustment')),
  amount numeric(14,6) not null,
  balance_after numeric(14,6) not null,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ledger_org_idx on public.ledger_entries(organization_id, created_at desc);
alter table public.ledger_entries enable row level security;
drop policy if exists "ledger: member read" on public.ledger_entries;
create policy "ledger: member read" on public.ledger_entries for select using (public.is_org_member(organization_id));

create or replace function public.reserve_job_credits(p_job_id uuid, p_amount numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_available numeric;
begin
  select organization_id into v_org from public.jobs where id = p_job_id;
  select available into v_available from public.credit_accounts where organization_id = v_org for update;
  if v_available is null or v_available < p_amount then raise exception 'insufficient_credits' using errcode = 'P0001'; end if;
  update public.credit_accounts set available = available - p_amount, reserved = reserved + p_amount, updated_at = now() where organization_id = v_org;
  insert into public.ledger_entries(organization_id, job_id, type, amount, balance_after)
  values(v_org, p_job_id, 'reserve', -p_amount, v_available - p_amount);
end;
$$;

create or replace function public.settle_job_credits(p_job_id uuid, p_reserved numeric, p_actual numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_available numeric;
begin
  select organization_id into v_org from public.jobs where id = p_job_id;
  update public.credit_accounts
    set available = available + greatest(p_reserved - p_actual, 0), reserved = greatest(reserved - p_reserved, 0), updated_at = now()
    where organization_id = v_org returning available into v_available;
  insert into public.ledger_entries(organization_id, job_id, type, amount, balance_after)
  values(v_org, p_job_id, 'charge', -p_actual, v_available);
end;
$$;

create or replace function public.release_job_credits(p_job_id uuid, p_amount numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_available numeric;
begin
  select organization_id into v_org from public.jobs where id = p_job_id;
  update public.credit_accounts
    set available = available + p_amount, reserved = greatest(reserved - p_amount, 0), updated_at = now()
    where organization_id = v_org returning available into v_available;
  insert into public.ledger_entries(organization_id, job_id, type, amount, balance_after)
  values(v_org, p_job_id, 'release', p_amount, v_available);
end;
$$;

create or replace function public.add_credits(p_organization_id uuid, p_amount numeric, p_external_id text, p_metadata jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_available numeric;
begin
  if exists(select 1 from public.ledger_entries where external_id = p_external_id and type = 'purchase') then return; end if;
  update public.credit_accounts set available = available + p_amount, updated_at = now()
    where organization_id = p_organization_id returning available into v_available;
  insert into public.ledger_entries(organization_id, type, amount, balance_after, external_id, metadata)
    values(p_organization_id, 'purchase', p_amount, v_available, p_external_id, p_metadata);
end;
$$;

create table if not exists public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  url text not null,
  secret_hash text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.webhook_endpoints enable row level security;
drop policy if exists "webhooks: admin all" on public.webhook_endpoints;
create policy "webhooks: admin all" on public.webhook_endpoints for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

-- A new account receives a personal workspace and a small test balance.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare org_id uuid;
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email,''), '@', 1)))
  on conflict (id) do nothing;

  insert into public.organizations(name, slug, created_by)
  values (
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email,'workspace'), '@', 1)) || '''s workspace',
    'ws-' || replace(new.id::text, '-', ''),
    new.id
  ) returning id into org_id;
  insert into public.organization_members(organization_id, user_id, role) values(org_id, new.id, 'owner');
  insert into public.credit_accounts(organization_id, available) values(org_id, 10.00);
  return new;
end;
$$;

insert into public.backends(id, provider, display_name, kind, qubits, native_gates, queue_seconds, fidelity, reliability, price_per_shot, price_per_task, metadata) values
  ('qci-aer-gpu', 'qci', 'QCI Aer GPU', 'simulator', 30, array['id','x','y','z','h','s','sdg','t','tdg','rx','ry','rz','cx','cz','swap','measure'], 2, 1, 0.999, 0.000001, 0.002, '{"region":"ord","accelerator":"NVIDIA cuQuantum"}'),
  ('ibm-brisbane', 'ibm', 'IBM Brisbane', 'qpu', 127, array['id','rz','sx','x','ecr','measure'], 780, 0.992, 0.975, 0.00035, 0.30, '{"execution":"runtime"}'),
  ('aws-sv1', 'aws-braket', 'Amazon SV1', 'simulator', 34, array['x','y','z','h','s','t','rx','ry','rz','cnot','cz','swap'], 8, 1, 0.995, 0.000075, 0, '{"region":"us-east-1"}'),
  ('ionq-aria-1', 'aws-braket', 'IonQ Aria 1', 'qpu', 25, array['gpi','gpi2','ms'], 1200, 0.996, 0.96, 0.00022, 0.30, '{"architecture":"trapped-ion"}'),
  ('iqm-garnet', 'aws-braket', 'IQM Garnet', 'qpu', 20, array['prx','cz','measure'], 480, 0.994, 0.965, 0.00145, 0.30, '{"architecture":"superconducting"}'),
  ('xanadu-borealis', 'xanadu', 'Xanadu Borealis', 'qpu', 216, array['squeezing','displacement','beamsplitter','measure'], 1800, 0.94, 0.91, 0.002, 1.00, '{"architecture":"photonic","availability":"partner"}'),
  ('quandela-mosaiq', 'quandela', 'Quandela MosaiQ', 'qpu', 12, array['phase','beamsplitter','measure'], 960, 0.96, 0.93, 0.0015, 0.50, '{"architecture":"photonic","availability":"partner"}'),
  ('qi-starmon-5', 'quantum-inspire', 'Starmon-5', 'qpu', 5, array['x','y','z','h','rx','ry','rz','cz','measure'], 300, 0.97, 0.94, 0.0005, 0.10, '{"architecture":"superconducting"}')
on conflict (id) do update set
  display_name = excluded.display_name, status = excluded.status, qubits = excluded.qubits,
  native_gates = excluded.native_gates, queue_seconds = excluded.queue_seconds,
  fidelity = excluded.fidelity, reliability = excluded.reliability,
  price_per_shot = excluded.price_per_shot, price_per_task = excluded.price_per_task,
  metadata = excluded.metadata, updated_at = now();

-- QRouter is a public developer product; authentication is no longer limited to
-- the old private-index email allowlist.
drop trigger if exists on_auth_user_created_allowlist on auth.users;

-- ════════════════════════════════════════════════════════════════════════════
-- 10. ADD ALLOWED USERS HERE  (edit the email, then re-run just this statement)
-- ════════════════════════════════════════════════════════════════════════════
-- insert into public.allowed_emails (email, added_by)
-- values ('you@example.com', 'founder')
-- on conflict (email) do nothing;
