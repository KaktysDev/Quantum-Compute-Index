# QRouter database apply runbook

> **Operators only — do not publish as customer documentation.** This runbook
> describes production database state, security hardening, and migration order.
> Keep it out of end-user product docs and public marketing surfaces.

How to get the live Supabase project from where it is now to the current
`supabase/` tree, in order, with a verification query after every step and a
rollback for each.

Read the whole file before running anything. Every query here is safe to run;
the statements that change data are called out explicitly.

## What state the database is actually in

`supabase/schema.sql` is applied. `supabase/qrouter.sql` is **not** — at least
not this version of it. A read-only probe confirmed that `public.circuits` and
`public.execution_groups` do not exist and that `public.jobs` has none of
`group_id`, `execution_key`, `circuit_id`, `execution_position`.

An *earlier* revision of `qrouter.sql` almost certainly was applied, because v1
is serving live Bearer-authenticated traffic and that path used to call
`consume_api_rate_limit()`, which only `qrouter.sql` creates. Treat the database
as **partially migrated to an unknown revision** and discover the real state in
step 0 rather than assuming.

## Order

| # | Step | Downtime | Reversible |
|---|------|----------|------------|
| 0 | Discovery | none | n/a (read-only) |
| 1 | `hotfix-jobs-insert-policy.sql` | none | yes |
| 2 | Prechecks for the full migration | none | n/a (read-only) |
| 3 | `qrouter.sql` | none | partly — see step 3 rollback |
| 4 | `access.sql` (only if you need to re-seed admins) | none | yes |
| 5 | Deploy the application | none | yes |
| 6 | Post-deploy verification | none | n/a |

Step 1 is independent and urgent: run it today, on its own, without waiting for
the rest. Steps 3 and 5 can be done in either order — every code change either
tolerates the pre-migration schema or belongs to v2, which is not live.

---

## Step 0 — Discovery (read-only)

Run all of these and keep the output. They tell you which revision you are on.

```sql
-- Which of the v2 objects already exist?
select
  to_regclass('public.circuits')            as circuits,
  to_regclass('public.execution_groups')    as execution_groups,
  to_regclass('public.artifacts')           as artifacts,
  to_regclass('public.api_rate_windows')    as api_rate_windows,
  to_regclass('public.rate_limit_windows')  as rate_limit_windows,
  to_regclass('public.projects')            as projects,
  to_regclass('public.github_connections')  as github_connections;

-- Which qrouter functions are installed?
select proname, pg_get_function_identity_arguments(oid) as args
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'claim_qrouter_jobs','claim_qrouter_poll_jobs','finalize_qrouter_job',
    'queue_job_with_quote','queue_execution_group_with_quotes',
    'requeue_awaiting_payment_jobs','requeue_awaiting_payment_execution_groups',
    'consume_api_rate_limit','consume_rate_limit','purge_rate_limit_windows',
    'purge_circuit_data','purge_expired_circuits','erase_user_personal_data',
    'claim_webhook_deliveries','handle_new_user','is_org_member','is_org_admin'
  )
order by proname;

-- Is the free-compute hole open right now? Any row here is the vulnerability.
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'jobs';

-- Does authenticated still hold write privileges on jobs?
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'jobs'
  and grantee in ('anon','authenticated')
order by grantee, privilege_type;
```

### `CREATE TABLE IF NOT EXISTS` will not repair a drifted table

This is the trap in a partial deploy. `qrouter.sql` creates most tables with
`create table if not exists`, which **silently does nothing** if a table of that
name already exists with a different shape. Re-running the file does not fix a
table that was created by an older revision with fewer or different columns.

Compare the shape of every table the migration creates against what is really
there before you trust the run:

```sql
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('organizations','organization_members','api_keys','jobs','quotes',
                     'job_attempts','job_events','artifacts','credit_accounts','ledger_entries',
                     'webhook_endpoints','webhook_deliveries','api_rate_windows','rate_limit_windows',
                     'circuits','execution_groups','projects','github_connections','provider_health')
order by table_name, ordinal_position;
```

If a table exists but is missing columns the code needs, add them by hand with
`alter table ... add column if not exists ...` copied from the matching
`create table` block in `qrouter.sql`. Do **not** drop and recreate a populated
table.

---

## Step 1 — Close the free-compute hole (URGENT, do this first)

File: `supabase/hotfix-jobs-insert-policy.sql`.

`public.jobs` is the only table with a user-facing INSERT policy, and its
`with check` validates `organization_id` and nothing else. Any signed-in account
can POST a row straight to `/rest/v1/jobs` with `status='queued'`,
`quote_id=null`, `shots=1000000` and an expensive QPU in `selected_backend_id`.
`claim_qrouter_jobs()` picks dispatch candidates on status alone, and
`finalize_qrouter_job()` only bills when a quote is attached, so that row runs on
real hardware and is never charged.

Signup is gated by `enforce_email_allowlist()`, so this is reachable by approved
pilot accounts rather than by the open internet — it is still every customer
being able to mine unlimited free QPU time.

### Precheck (must return 0 rows)

The hotfix stops dispatching jobs with no quote or no credit reservation. Any
row this returns is already unbilled work and would sit in `queued` forever
after the change:

```sql
select id, organization_id, status, shots, selected_backend_id, created_at
from public.jobs job
where job.status in ('queued','dispatching')
  and (job.quote_id is null
       or not exists (select 1 from public.ledger_entries entry
                      where entry.type = 'reserve' and entry.job_id = job.id));
```

If it returns rows, inspect them. Legitimate-looking ones can be repaired by
inserting the missing reservation; anything hand-crafted should be cancelled.
Only then apply part 3 of the hotfix. Parts 1 and 2 are safe regardless — they
are the actual security fix and cannot strand anything.

### Apply

Paste the whole of `supabase/hotfix-jobs-insert-policy.sql` into the SQL editor.

### Verify

```sql
-- (a) expect zero rows
select policyname, cmd from pg_policies
where schemaname='public' and tablename='jobs' and cmd='INSERT';

-- (b) expect SELECT only
select grantee, privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name='jobs' and grantee in ('anon','authenticated');

-- (c) expect true
select pg_get_functiondef('public.claim_qrouter_jobs(integer,integer)'::regprocedure)
       like '%reserve%' as guard_installed;
```

Then watch the orchestrator for one cycle and confirm queued jobs still move to
`dispatching`.

### Rollback

Reverting part 3 alone restores dispatch for every queued job while keeping the
hole closed; the original function body is in the comment block at the bottom of
the hotfix file. Parts 1 and 2 should not be rolled back — nothing in the
application inserts jobs as the end user, so there is nothing for them to break.

---

## Step 2 — Prechecks for the full migration

### 2a. `jobs_status_check` is dropped and re-added

`qrouter.sql` does:

```sql
alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs add constraint jobs_status_check check (status in (...));
```

The `add constraint` validates every existing row and **aborts the whole
migration** if any row holds a status outside the list.

```sql
select status, count(*) from public.jobs group by status order by 2 desc;

-- Anything here breaks the migration. Expect zero rows.
select distinct status from public.jobs
where status not in ('created','analyzing','quoted','awaiting_payment','funds_reserved',
                     'queued','dispatching','submitted','processing','completed','failed',
                     'cancellation_requested','cancelled');
```

If the second query returns anything, either add that status to the check
constraint in `qrouter.sql` or correct the rows before proceeding.

Note the validation takes an `ACCESS EXCLUSIVE` lock on `public.jobs` for the
duration of the scan. On a pilot-sized table this is milliseconds; if `jobs` has
grown large, run the migration during a quiet window.

### 2b. The organizations FK rewrite

`qrouter.sql` makes `organizations.created_by` nullable and switches the foreign
key to `ON DELETE SET NULL` so account erasure becomes possible at all. Adding
the new constraint validates existing rows:

```sql
-- Expect zero rows: every created_by must point at a live auth user.
select o.id, o.created_by from public.organizations o
where o.created_by is not null
  and not exists (select 1 from auth.users u where u.id = o.created_by);

-- Current state of the constraint. confdeltype 'r' = restrict, 'a' = no action, 'n' = set null.
select conname, confdeltype from pg_constraint
where conrelid = 'public.organizations'::regclass and contype = 'f';
```

### 2c. `circuits.expires_at` backfill

Only relevant if `public.circuits` already exists. The migration gives the column
a 90-day default and backfills nulls to `created_at + 90 days`. Check what you
are about to backfill:

```sql
select count(*) filter (where expires_at is null) as will_be_backfilled,
       count(*) as total
from public.circuits;
```

If the table does not exist yet (the expected case), this step is a no-op.

### 2d. Take a backup

Supabase → Database → Backups, or `pg_dump`. Step 3 changes constraints and
grants; a snapshot is the only clean rollback for those.

---

## Step 3 — Apply `supabase/qrouter.sql`

Paste the whole file into the SQL editor. It is written to be re-runnable.

### What it changes beyond the original migration

| Change | Kind | Risk |
|---|---|---|
| Drops the `jobs` INSERT policy, revokes write grants | Security | none — every app write uses the service role |
| `claim_qrouter_jobs` requires a quote + `reserve` ledger entry | Security | see the step 1 precheck |
| `organizations.created_by` → nullable, `ON DELETE SET NULL` | Schema | validates existing rows; see 2b |
| `api_keys`: table-wide SELECT revoked, column grant excludes `key_hash` | Security | console reads via service role; admin page selects only non-secret columns |
| New `purge_circuit_data`, `purge_expired_circuits`, `erase_user_personal_data` | New functions | additive |
| New `rate_limit_windows` + `consume_rate_limit` + `purge_rate_limit_windows` | New table/functions | additive; `consume_api_rate_limit` kept and now delegates |
| `requeue_awaiting_payment_execution_groups` status-filters and isolates each group | Bug fix | strictly fewer exceptions than before |
| `queue_execution_group_with_quotes` returns instead of raising when nothing is pending | Bug fix | strictly fewer exceptions |
| `circuits.expires_at` default + backfill + retention index | Schema | no-op unless `circuits` exists |
| `search_path` pinned to `public, pg_temp` on every SECURITY DEFINER function | Hardening | none |
| `handle_new_user` records the signup grant in the ledger | Behaviour | new `adjustment` ledger row per signup |

### Verify

```sql
-- v2 tables landed
select to_regclass('public.circuits'), to_regclass('public.execution_groups'),
       to_regclass('public.rate_limit_windows');

-- v2 columns landed on jobs
select column_name from information_schema.columns
where table_schema='public' and table_name='jobs'
  and column_name in ('group_id','circuit_id','execution_key','execution_position');
-- expect 4 rows

-- New functions exist
select proname from pg_proc
where pronamespace='public'::regnamespace
  and proname in ('purge_circuit_data','purge_expired_circuits','erase_user_personal_data',
                  'consume_rate_limit','purge_rate_limit_windows')
order by proname;
-- expect 5 rows

-- Erasure is now possible: expect 'n' (set null)
select confdeltype from pg_constraint
where conrelid='public.organizations'::regclass and conname='organizations_created_by_fkey';

-- key_hash is no longer readable by members: expect it NOT to appear
select column_name, privilege_type from information_schema.column_privileges
where table_schema='public' and table_name='api_keys' and grantee='authenticated'
order by column_name;

-- No SECURITY DEFINER function left without pg_temp: expect zero rows
select p.proname, p.proconfig from pg_proc p
where p.pronamespace='public'::regnamespace and p.prosecdef
  and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c
                  where c like 'search_path=%pg_temp%');

-- Rate limiter round-trips (writes one throwaway counter row)
select public.consume_rate_limit('runbook-smoke', 5, 60);  -- expect true
select public.purge_rate_limit_windows(interval '0');       -- cleans it up
```

Then run one orchestrator cycle and confirm v1 jobs still dispatch, poll, and
finalize.

### Rollback

Restore the step 2d backup. If that is too heavy, the individually reversible
pieces are:

```sql
-- Restore the permissive dispatch guard (keeps the security fix in place)
--   see the rollback block at the bottom of hotfix-jobs-insert-policy.sql

-- Restore table-wide api_keys reads
grant select on public.api_keys to authenticated;

-- Restore the previous FK (this re-blocks account deletion)
alter table public.organizations drop constraint organizations_created_by_fkey;
alter table public.organizations
  add constraint organizations_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete restrict;
```

New tables and functions are additive; leaving them in place is harmless.

---

## Step 4 — `supabase/access.sql` (optional)

Only needed if you are re-seeding the console allowlist. The admin seed block is
now commented out and placeholder-only, because committing real personal email
addresses puts them in git history and hands anyone with repository read access
a target list.

**Three real addresses were previously committed in this file and are still
present in git history and in the live `public.admin_emails` table.** Removing
them from either is your call:

- Live table: `delete from public.admin_emails where email = '...';` — make sure
  at least one admin remains or nobody can reach Admin → Access.
- Git history: requires a rewrite (`git filter-repo`) and a force push. Not
  something to do without coordinating with everyone who has a clone.

Re-running `access.sql` now only replaces the functions; it seeds nothing.

---

## Step 5 — Deploy the application

New environment variables to set before or with the deploy — see the README and
`.env.local.example` for the full list. None of them are required for the app to
boot; each has a safe default.

Deploy order does not matter:

- Code deployed **before** the migration: `consume_rate_limit` is missing, so
  `src/lib/security/rate-limit.ts` falls back to a per-instance counter and logs
  a warning. Rate limiting still applies, just per lambda instead of globally.
  Everything else either is v1 (unaffected) or v2 (not live).
- Migration applied **before** the code: every change is backwards compatible
  with the currently deployed application. `consume_api_rate_limit` is retained
  and now delegates to the shared organization bucket.

---

## Step 6 — Post-deploy verification

```sql
-- Nobody has re-acquired write access to jobs
select grantee, privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name='jobs' and grantee in ('anon','authenticated');

-- The limiter is being used
select bucket, window_start, request_count from public.rate_limit_windows
order by window_start desc limit 20;

-- Nothing stalled behind the new dispatch guard
select count(*) from public.jobs
where status='queued' and next_attempt_at < now() - interval '15 minutes';
```

Schedule the two new maintenance functions. Either add them to the orchestrator
cron or, if `pg_cron` is enabled:

```sql
select cron.schedule('qrouter-rate-limit-sweep', '*/15 * * * *',
                     $$select public.purge_rate_limit_windows()$$);
select cron.schedule('qrouter-retention-purge', '17 3 * * *',
                     $$select public.purge_expired_circuits(200)$$);
```

`purge_expired_circuits` scrubs database rows only. Encrypted artifact objects in
Supabase Storage / Vultr object storage are removed by the application route at
`/api/cron/retention`, which calls the same function and then deletes the
objects. Prefer the HTTP route so both halves stay in step; use `pg_cron` only as
a backstop.

---

## Does any of this change the safety assessment of applying `qrouter.sql`?

The previous assessment — purely additive, safe on a populated database — was
right for the original file. **It no longer fully holds.** The additive parts are
still additive, but this revision adds four changes that are not:

1. **`organizations.created_by` FK rewrite.** Drops and re-adds a foreign key,
   validating every existing row and briefly taking an `ACCESS EXCLUSIVE` lock on
   `public.organizations`. Precheck 2b covers it. This is the change that makes
   account erasure possible at all, so it is worth doing, but it is a real
   constraint change on a populated table.
2. **`claim_qrouter_jobs` dispatch guard.** Behaviour-changing: a queued job with
   no quote or no `reserve` ledger entry stops being dispatched. That is the
   point, but if any legitimate live row is in that state it stalls. Precheck in
   step 1 covers it.
3. **`api_keys` privilege change.** `revoke select ... from authenticated` plus a
   column-level grant back. Any consumer selecting `key_hash` through an
   RLS-bound client starts getting a permission error. Nothing in this repository
   does — the console reads api_keys through the service role and the admin page
   selects only non-secret columns — but a third-party client or a saved SQL
   snippet would break.
4. **`revoke insert, update, delete`** on `jobs`, `circuits`, `execution_groups`
   from `anon`/`authenticated`. Behaviour-neutral for this codebase, verified by
   grep: every write goes through `createAdminClient()`.

Everything else remains additive and safe: new tables, new functions, four
nullable columns on `jobs`, a partial unique index covering zero existing rows,
and guarded function replacements that v1 rows skip.
