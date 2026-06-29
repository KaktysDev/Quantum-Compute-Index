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
  role       text not null default 'member',
  created_at timestamptz not null default now()
);
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

-- Any signed-in (therefore allowlisted) user may manage provider keys.
drop policy if exists "provider_keys: authenticated all" on public.provider_keys;
create policy "provider_keys: authenticated all"
  on public.provider_keys for all
  to authenticated
  using (true)
  with check (true);

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

-- ════════════════════════════════════════════════════════════════════════════
-- 10. ADD ALLOWED USERS HERE  (edit the email, then re-run just this statement)
-- ════════════════════════════════════════════════════════════════════════════
-- insert into public.allowed_emails (email, added_by)
-- values ('you@example.com', 'founder')
-- on conflict (email) do nothing;
