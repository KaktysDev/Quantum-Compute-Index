# What to run in Supabase today

> **Operators only — do not publish as customer documentation.** This runbook is
> for people who administer the Supabase project. It includes security-hardening
> and migration steps that are outside the public API surface.

Copy-paste guide for the Supabase **SQL Editor**. Do **not** re-apply the entire
`schema.sql` on a populated production database.

For discovery, rollback, and edge cases, see [`APPLY-V2-MIGRATION.md`](./APPLY-V2-MIGRATION.md).

---

## Why `qrouter.sql` (not full `schema.sql`)

| File | Use on an existing install |
|------|----------------------------|
| `schema.sql` | Bootstrap / greenfield only. Re-running it on a live DB can fight existing policies, constraints, and data. |
| `qrouter.sql` | The incremental apply for QRouter + v2 objects. Safe to re-run; uses `IF NOT EXISTS` / `CREATE OR REPLACE` / `ADD COLUMN IF NOT EXISTS`. |
| `hotfix-jobs-insert-policy.sql` | Urgent security fix. Independent of v2; run first. |

`schema.sql` is already applied on production. Apply the hotfix, then `qrouter.sql`.

---

## Step 1 — Immediate hotfix (do this first)

**File:** [`hotfix-jobs-insert-policy.sql`](./hotfix-jobs-insert-policy.sql)

1. Optional but recommended — run the precheck inside that file’s comment block first (queued jobs with no quote / no `reserve` ledger row). Expect **0 rows**.
2. Paste the **entire** file into the SQL Editor and run it.

**Quick verify after apply:**

```sql
-- Expect zero INSERT policies on jobs
select policyname, cmd from pg_policies
where schemaname = 'public' and tablename = 'jobs' and cmd = 'INSERT';

-- Expect SELECT only for anon/authenticated
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'jobs'
  and grantee in ('anon', 'authenticated')
order by grantee, privilege_type;
```

---

## Step 2 — Precheck before full `qrouter.sql`

This must succeed or the migration’s `jobs_status_check` constraint will abort:

```sql
SELECT DISTINCT status FROM jobs;
```

Every status must be one of:

`created`, `analyzing`, `quoted`, `awaiting_payment`, `funds_reserved`,
`queued`, `dispatching`, `submitted`, `processing`, `completed`, `failed`,
`cancellation_requested`, `cancelled`

If anything else appears, fix or map those rows before Step 3 (see
`APPLY-V2-MIGRATION.md` Step 2).

---

## Step 3 — Apply `qrouter.sql`

1. Open [`qrouter.sql`](./qrouter.sql).
2. Paste the **entire** file into the SQL Editor.
3. Run it once. It is written to be re-runnable.

Optional afterward (only if you need them): `access.sql` (allowlist re-seed),
`admin.sql`, `chat.sql`, `contact.sql` — see the full runbook. Do **not** treat
those as required for closing the jobs hole or enabling v2 tables.

---

## Step 4 — Post-apply verification

Run all of these. They prove the v2 surface the app expects is present.

```sql
-- Tables exist (both should be non-null)
select
  to_regclass('public.circuits')         as circuits,
  to_regclass('public.execution_groups') as execution_groups;

-- jobs.group_id (and related v2 columns)
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'jobs'
  and column_name in ('group_id', 'circuit_id', 'execution_key', 'execution_position')
order by column_name;
-- expect 4 rows

-- queue_execution_group_with_quotes RPC exists
select proname, pg_get_function_identity_arguments(oid) as args
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname = 'queue_execution_group_with_quotes';
-- expect 1 row: (uuid, jsonb)
```

Optional security smoke (from the runbook):

```sql
select proname from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'purge_circuit_data', 'purge_expired_circuits', 'erase_user_personal_data',
    'consume_rate_limit', 'queue_execution_group_with_quotes'
  )
order by proname;
```

---

## Done checklist

- [ ] Hotfix applied and INSERT policies on `jobs` are gone
- [ ] `SELECT DISTINCT status FROM jobs;` reviewed
- [ ] Full `qrouter.sql` applied
- [ ] `circuits`, `execution_groups`, `jobs.group_id`, `queue_execution_group_with_quotes` verified
- [ ] Deploy / restart the app that matches this working tree
- [ ] Run a smoke job (see [`../docs/TRY-THE-API.md`](../docs/TRY-THE-API.md))
