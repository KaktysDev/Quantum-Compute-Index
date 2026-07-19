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

-- ── Assistant usage quotas ───────────────────────────────────────────────────
-- Org-scoped message + token budgets in fixed windows (default 3 h), so a
-- signed-in user can't farm the Gemini key. Consumed via service role only.

create table if not exists public.assistant_usage (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  window_start    timestamptz not null,
  messages        integer not null default 0,
  tokens          bigint not null default 0,
  primary key (organization_id, window_start)
);
alter table public.assistant_usage enable row level security;
-- No policies: service-role access only.

-- Atomically count one message and report whether the org is within budget.
create or replace function public.consume_assistant_quota(
  p_org uuid, p_msg_limit integer, p_token_limit bigint, p_window_seconds integer default 10800
) returns table (allowed boolean, messages integer, tokens bigint, reset_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare w timestamptz; m integer; t bigint;
begin
  w := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.assistant_usage (organization_id, window_start, messages)
    values (p_org, w, 1)
    on conflict (organization_id, window_start)
    do update set messages = assistant_usage.messages + 1
    returning assistant_usage.messages, assistant_usage.tokens into m, t;
  delete from public.assistant_usage where window_start < now() - interval '2 days';
  return query select (m <= p_msg_limit and t < p_token_limit), m, t,
    w + make_interval(secs => p_window_seconds);
end $$;
revoke all on function public.consume_assistant_quota(uuid, integer, bigint, integer) from public;
grant execute on function public.consume_assistant_quota(uuid, integer, bigint, integer) to service_role;

-- Add the streamed token count after a turn completes.
create or replace function public.record_assistant_tokens(
  p_org uuid, p_tokens bigint, p_window_seconds integer default 10800
) returns void language plpgsql security definer set search_path = public as $$
declare w timestamptz;
begin
  w := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.assistant_usage (organization_id, window_start, tokens)
    values (p_org, w, p_tokens)
    on conflict (organization_id, window_start)
    do update set tokens = assistant_usage.tokens + p_tokens;
end $$;
revoke all on function public.record_assistant_tokens(uuid, bigint, integer) from public;
grant execute on function public.record_assistant_tokens(uuid, bigint, integer) to service_role;
