# Incremental production migrations

This directory records the campaign rollout against QRouter's existing legacy schema. It is not a complete database bootstrap. Install the base schema and its existing SQL prerequisites in their documented order before applying these migrations to a new project.

Apply pending files in version order through Supabase migration tooling. The versions match production's migration history. Do not rerun the standalone schema snapshots as a separate migration path; `../experiments.sql` and `../experiment-billing.sql` show the current rerunnable definitions, including changes introduced by later migrations.

New migration files must be generated with `supabase migration new <name>` before adding reviewed SQL. See `../../docs/EXPERIMENT-ROLLOUT.md` for the production rollout record and verification boundaries.
