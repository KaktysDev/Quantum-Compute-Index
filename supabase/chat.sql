-- ════════════════════════════════════════════════════════════════════════════
-- QRouter console assistant — chat memory.
-- Run this in Supabase → SQL Editor (safe to re-run).
-- Threads/messages are org-scoped and accessed ONLY via the service role from
-- /api/chat (the route authenticates the session first), so RLS stays closed.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.chat_threads (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id         uuid references auth.users (id) on delete set null,
  title           text not null default 'New chat',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists chat_threads_org_idx on public.chat_threads (organization_id, updated_at desc);
alter table public.chat_threads enable row level security;
-- No policies: service-role access only.

create table if not exists public.chat_messages (
  id         bigint generated always as identity primary key,
  thread_id  uuid not null references public.chat_threads (id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  thoughts   text,
  meta       jsonb,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_thread_idx on public.chat_messages (thread_id, id);
alter table public.chat_messages enable row level security;
-- No policies: service-role access only.
