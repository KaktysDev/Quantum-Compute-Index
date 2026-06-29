-- ════════════════════════════════════════════════════════════════════════════
-- QuantumForge — Contact form + notification inbox
-- ────────────────────────────────────────────────────────────────────────────
-- Run this in Supabase → SQL Editor if you already ran schema.sql earlier.
-- (It's also included in schema.sql, and is safe to re-run.)
--
-- THEN edit the emails at the BOTTOM to choose who can see the submissions.
-- ════════════════════════════════════════════════════════════════════════════

-- Submissions from the public "Request access" / Contact form.
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

-- Hardcoded allowlist of who can READ the inbox (NOT every dashboard user).
create table if not exists public.contact_viewers (
  email      text primary key,
  added_by   text,
  created_at timestamptz not null default now()
);
alter table public.contact_viewers enable row level security;

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

-- ════════════════════════════════════════════════════════════════════════════
-- 👇 EDIT THIS: the Google accounts that may see contact submissions.
--    Add or remove lines, then run. Only these emails get the inbox + badge.
-- ════════════════════════════════════════════════════════════════════════════
insert into public.contact_viewers (email, added_by) values
  ('your-email@gmail.com', 'setup')
  -- , ('teammate@gmail.com', 'setup')
on conflict (email) do nothing;
