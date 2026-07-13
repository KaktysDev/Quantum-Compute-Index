-- ════════════════════════════════════════════════════════════════════════════
-- QuantumForge — Admin console
-- ────────────────────────────────────────────────────────────────────────────
-- Run this whole file in Supabase → SQL Editor (safe to re-run).
-- THEN edit the emails at the BOTTOM — those accounts get the Admin tab.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Hardcoded admin allowlist ────────────────────────────────────────────
create table if not exists public.admin_emails (
  email      text primary key,
  added_by   text,
  created_at timestamptz not null default now()
);
alter table public.admin_emails enable row level security;
-- No policies → invisible to anon/authenticated. Only the SQL editor and the
-- service role can touch the list, and the function below reads it.

-- Is the current signed-in user an admin?
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_emails a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ── 2. User support reports ─────────────────────────────────────────────────
create table if not exists public.user_reports (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  email       text,
  category    text not null default 'other'
              check (category in ('bug','billing','provider','account','other')),
  subject     text not null,
  message     text not null,
  status      text not null default 'open'
              check (status in ('open','in_progress','resolved','closed')),
  admin_notes text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists user_reports_created_idx on public.user_reports (created_at desc);
create index if not exists user_reports_user_idx on public.user_reports (user_id, created_at desc);
alter table public.user_reports enable row level security;

drop policy if exists "reports: insert own" on public.user_reports;
create policy "reports: insert own"
  on public.user_reports for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "reports: read own" on public.user_reports;
create policy "reports: read own"
  on public.user_reports for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "reports: admin read" on public.user_reports;
create policy "reports: admin read"
  on public.user_reports for select
  to authenticated
  using (public.is_admin());

drop policy if exists "reports: admin update" on public.user_reports;
create policy "reports: admin update"
  on public.user_reports for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ── 3. Admin read access to the control plane ───────────────────────────────
-- Additive (permissive) policies: members keep their own access, admins can
-- additionally see everything. All read-only — writes stay member/service-role.

drop policy if exists "profiles: admin read" on public.profiles;
create policy "profiles: admin read"
  on public.profiles for select to authenticated using (public.is_admin());

drop policy if exists "organizations: admin read" on public.organizations;
create policy "organizations: admin read"
  on public.organizations for select to authenticated using (public.is_admin());

drop policy if exists "members: admin read" on public.organization_members;
create policy "members: admin read"
  on public.organization_members for select to authenticated using (public.is_admin());

drop policy if exists "api_keys: admin read" on public.api_keys;
create policy "api_keys: admin read"
  on public.api_keys for select to authenticated using (public.is_admin());

drop policy if exists "jobs: admin read" on public.jobs;
create policy "jobs: admin read"
  on public.jobs for select to authenticated using (public.is_admin());

drop policy if exists "quotes: admin read" on public.quotes;
create policy "quotes: admin read"
  on public.quotes for select to authenticated using (public.is_admin());

drop policy if exists "credits: admin read" on public.credit_accounts;
create policy "credits: admin read"
  on public.credit_accounts for select to authenticated using (public.is_admin());

drop policy if exists "ledger: admin read" on public.ledger_entries;
create policy "ledger: admin read"
  on public.ledger_entries for select to authenticated using (public.is_admin());

-- Admins also see the contact inbox (in addition to contact_viewers).
drop policy if exists "contact: admin read" on public.contact_submissions;
create policy "contact: admin read"
  on public.contact_submissions for select to authenticated using (public.is_admin());

drop policy if exists "contact: admin update" on public.contact_submissions;
create policy "contact: admin update"
  on public.contact_submissions for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- 👇 EDIT THIS: the Google accounts that get the Admin tab. Add/remove lines,
--    then run. Changes apply on the next page load — no redeploy needed.
-- ════════════════════════════════════════════════════════════════════════════
insert into public.admin_emails (email, added_by) values
  ('lagodaoleg1357@gmail.com', 'setup'),
  ('qci.research@gmail.com', 'setup')
on conflict (email) do nothing;
