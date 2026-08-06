-- ════════════════════════════════════════════════════════════════════════════
-- HOTFIX — close the "free quantum compute" hole on public.jobs
--
-- WHAT THIS FIXES
--   public.jobs was the only table in the schema with a user-facing INSERT
--   policy. Its `with check` validated the organization_id and nothing else, so
--   any signed-up user could POST a row straight to /rest/v1/jobs with the
--   public anon key carrying status='queued', quote_id=null, shots=1000000 and
--   an expensive QPU in selected_backend_id. claim_qrouter_jobs() selects
--   dispatch candidates on status alone, and finalize_qrouter_job() only
--   charges when a quote is attached — so that row runs on real hardware and is
--   never billed. handle_new_user() grants every new signup credits, so the
--   accounts are free and repeatable.
--
-- WHAT IT DOES
--   1. Drops the INSERT policy under both names it has shipped under.
--   2. Revokes the underlying INSERT/UPDATE/DELETE grant from anon and
--      authenticated, so the hole cannot reopen if a policy is ever re-added.
--   3. Hardens claim_qrouter_jobs() to dispatch only jobs that carry a quote
--      AND have a matching `reserve` ledger entry — defence in depth so this
--      class of bug cannot recur.
--
-- WHY IT CANNOT BREAK THE RUNNING v1 PIPELINE
--   Every jobs INSERT in the application is made with the service role, which
--   bypasses RLS and is unaffected by these grants:
--     src/app/api/v1/jobs/route.ts:102     admin = createAdminClient()
--     src/lib/qrouter/v2-service.ts:342    admin = createAdminClient()
--   No browser/component code inserts, updates, or deletes jobs; the dashboard
--   only runs SELECTs. Reads are untouched — the "member read" SELECT policy
--   and the SELECT grant both stay in place.
--   The orchestrator (src/app/api/internal/jobs/route.ts) calls
--   claim_qrouter_jobs as the service role, and every legitimate queued job is
--   put into that state by queue_job_with_quote() or
--   requeue_awaiting_payment_jobs(), both of which write the quote and the
--   `reserve` ledger entry in the same transaction as the 'queued' status.
--
-- Safe to re-run. Run it in the Supabase SQL editor as a whole.
-- ════════════════════════════════════════════════════════════════════════════

-- ── PRECHECK — run this FIRST, on its own ───────────────────────────────────
-- Step 3 stops dispatching jobs that have no quote or no reserve entry. This
-- must return 0. If it does not, those rows are already-unbilled work: inspect
-- them and cancel or repair them BEFORE applying step 3, or they will sit in
-- 'queued' forever.
--
--   select id, organization_id, status, shots, selected_backend_id, created_at
--   from public.jobs job
--   where job.status in ('queued','dispatching')
--     and (job.quote_id is null
--          or not exists (select 1 from public.ledger_entries entry
--                         where entry.type = 'reserve' and entry.job_id = job.id));

begin;

-- ── 1. Remove the user-facing INSERT policy ─────────────────────────────────
-- Two names because supabase/qrouter.sql and supabase/schema.sql each created
-- one; a database that has seen both files has both policies installed.
drop policy if exists "job member create" on public.jobs;
drop policy if exists "jobs: member create" on public.jobs;

-- ── 2. Remove the underlying grant ──────────────────────────────────────────
-- Supabase's default privileges hand anon/authenticated full DML on public
-- tables; RLS is the only thing holding them back. Dropping the write grant
-- means a future policy mistake is no longer immediately exploitable.
revoke insert, update, delete on public.jobs from anon, authenticated;

-- ── 3. Only dispatch jobs that were actually quoted and reserved ────────────
-- Same signature and same return shape as before, so the orchestrator needs no
-- change. The added predicate is the defence-in-depth guard: a hand-inserted
-- row has no quote and no reserve entry, so it is never claimed.
create or replace function public.claim_qrouter_jobs(p_limit integer default 25, p_lease_seconds integer default 120)
returns setof public.jobs language sql security definer set search_path = public, pg_temp as $$
  with candidates as (
    select job.id from public.jobs job
    where ((job.status = 'queued' and job.next_attempt_at <= now())
        or (job.status = 'dispatching' and job.lease_expires_at <= now()))
      and job.quote_id is not null
      and exists (
        select 1 from public.ledger_entries entry
        where entry.type = 'reserve' and entry.job_id = job.id
      )
    order by job.next_attempt_at, job.created_at
    for update skip locked
    limit greatest(1, least(p_limit, 100))
  )
  update public.jobs as job
  set status = 'dispatching',
      lease_expires_at = now() + make_interval(secs => greatest(30, p_lease_seconds)),
      updated_at = now()
  from candidates where job.id = candidates.id
  returning job.*
$$;
revoke all on function public.claim_qrouter_jobs(integer, integer) from public;
grant execute on function public.claim_qrouter_jobs(integer, integer) to service_role;

commit;

-- ── VERIFY — all three should hold ──────────────────────────────────────────
-- (a) No INSERT policy remains on jobs. Expect zero rows.
--   select policyname, cmd from pg_policies
--   where schemaname = 'public' and tablename = 'jobs' and cmd = 'INSERT';
--
-- (b) anon/authenticated hold no write privilege on jobs. Expect only SELECT.
--   select grantee, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'jobs'
--     and grantee in ('anon','authenticated') order by grantee, privilege_type;
--
-- (c) The guard is present in the deployed function body. Expect true.
--   select pg_get_functiondef('public.claim_qrouter_jobs(integer,integer)'::regprocedure)
--          like '%reserve%' as guard_installed;

-- ── ROLLBACK (only if step 3 stalls a legitimate job) ───────────────────────
-- Reverting step 3 alone restores dispatch for every queued job while KEEPING
-- the actual hole closed — steps 1 and 2 are the security fix and should stay.
--   create or replace function public.claim_qrouter_jobs(p_limit integer default 25, p_lease_seconds integer default 120)
--   returns setof public.jobs language sql security definer set search_path = public, pg_temp as $$
--     with candidates as (
--       select id from public.jobs
--       where (status = 'queued' and next_attempt_at <= now())
--          or (status = 'dispatching' and lease_expires_at <= now())
--       order by next_attempt_at, created_at
--       for update skip locked
--       limit greatest(1, least(p_limit, 100))
--     )
--     update public.jobs as job
--     set status = 'dispatching', lease_expires_at = now() + make_interval(secs => greatest(30, p_lease_seconds)), updated_at = now()
--     from candidates where job.id = candidates.id
--     returning job.*
--   $$;
--
-- NOTE: after supabase/qrouter.sql is applied, jobs gains group_id and v2
-- reserves credits once per execution group rather than per job. qrouter.sql
-- ships a claim_qrouter_jobs that accepts either a per-job reserve entry or a
-- group-level one; re-running this hotfix afterwards would revert that and
-- strand v2 executions. Apply this file now, and let qrouter.sql supersede it.
