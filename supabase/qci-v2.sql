-- ═══════════════════════════════════════════════════════════════════════════
-- QCI v2 — index points, the device ledger, and the raw observation archive.
--
-- Run this once against the project (Supabase SQL editor). It is additive and
-- idempotent: v1's `qci_snapshots` is left untouched so the existing app keeps
-- rendering while v2 accumulates its own history alongside.
--
-- DESIGN NOTE — WHY EACH ROW IS SELF-CONTAINED
-- v1 stored a price and a components blob, and the computation depended on
-- reading "the previous row", which made a published number impossible to
-- reproduce after the fact. Every v2 row carries the full inputs, the ledger
-- state that produced it, and the methodology version. Given a row you can
-- re-derive it exactly, and given two consecutive rows you can re-derive the
-- move. That is a hard requirement for anything claiming to be a standardised
-- benchmark (IOSCO Principles for Financial Benchmarks, principles 7 and 11).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Index points ─────────────────────────────────────────────────────────
create table if not exists public.qci_index_points (
  id             bigint generated always as identity primary key,
  ts             timestamptz not null,
  -- ET calendar date. Unique so a re-run overwrites rather than duplicating.
  index_date     date not null,

  level          numeric not null,          -- chain-linked level, 1000 at inception
  change_pct     numeric not null default 0,
  usd_per_qpu_hour numeric,                 -- headline: USD per QPU-hour
  usd_per_qcu    numeric,                   -- quality-adjusted price

  coverage       numeric not null default 0, -- share of basket re-measured, 0..1
  matched        integer not null default 0, -- devices in the matched sample
  status         text not null default 'provisional', -- 'final' | 'provisional'

  cost_basis_per_hour  numeric,             -- modelled marginal cost, USD/hour
  cost_coverage_ratio  numeric,             -- price / modelled cost

  -- Full computed point: devices, factors, attribution, exclusions.
  point          jsonb not null,
  -- The device ledger AFTER this run — the state the next run reads.
  ledger         jsonb not null,

  methodology    text not null,
  created_at     timestamptz not null default now()
);

create unique index if not exists qci_index_points_date_idx
  on public.qci_index_points (index_date);
create index if not exists qci_index_points_ts_idx
  on public.qci_index_points (ts desc);

alter table public.qci_index_points enable row level security;

-- Public read: the landing page shows the index without login.
drop policy if exists "qci_index_points: public read" on public.qci_index_points;
create policy "qci_index_points: public read"
  on public.qci_index_points for select
  to anon, authenticated
  using (true);
-- Writes happen only through the service role (cron / authenticated refresh).

-- ── 2. Raw observation archive ──────────────────────────────────────────────
-- Every field that fed the index, with its provenance, kept separately so the
-- audit trail survives even if the computation is later revised.
create table if not exists public.qci_observations (
  id            bigint generated always as identity primary key,
  index_date    date not null,
  device_id     text not null,
  provider      text not null,
  device        text not null,
  modality      text,
  region        text,

  price_per_hour numeric,
  price_basis    text,
  price_tier     text,          -- primary | official | published | modelled | assumed
  price_source   text,
  price_observed_at timestamptz,

  qubits         numeric,
  two_qubit_error numeric,
  layer_rate     numeric,
  online         boolean,
  queue_seconds  numeric,

  price_per_shot numeric,
  price_per_task numeric,

  raw            jsonb not null,
  created_at     timestamptz not null default now()
);

create index if not exists qci_observations_date_idx
  on public.qci_observations (index_date desc);
create index if not exists qci_observations_device_idx
  on public.qci_observations (device_id, index_date desc);
create unique index if not exists qci_observations_unique_idx
  on public.qci_observations (index_date, device_id);

alter table public.qci_observations enable row level security;

drop policy if exists "qci_observations: authenticated read" on public.qci_observations;
create policy "qci_observations: authenticated read"
  on public.qci_observations for select
  to authenticated
  using (true);

-- ── 3. Factor archive ───────────────────────────────────────────────────────
-- Energy, cryogenics, capital and FX inputs, with their real effective dates.
-- Stored separately because they update on their OWN cadence (monthly for EIA,
-- bi-annual for Eurostat, daily for ECB) rather than the index's daily one.
create table if not exists public.qci_factors (
  id           bigint generated always as identity primary key,
  index_date   date not null,
  factor_id    text not null,
  factor_group text not null,     -- energy | cryogenics | capital | labour | fx
  label        text,
  unit         text,
  value        numeric not null,
  tier         text not null,
  source       text not null,
  citation     text,
  observed_at  timestamptz,       -- when the SOURCE says the value was true
  fetched_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists qci_factors_date_idx on public.qci_factors (index_date desc);
create unique index if not exists qci_factors_unique_idx
  on public.qci_factors (index_date, factor_id);

alter table public.qci_factors enable row level security;

drop policy if exists "qci_factors: public read" on public.qci_factors;
create policy "qci_factors: public read"
  on public.qci_factors for select
  to anon, authenticated
  using (true);

-- ── 4. Refresh run log ──────────────────────────────────────────────────────
-- One row per attempt, successful or not. Without this an outage is invisible
-- after the fact, and "why did coverage drop on the 14th" is unanswerable.
create table if not exists public.qci_refresh_runs (
  id            bigint generated always as identity primary key,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  index_date    date,
  ok            boolean not null default false,
  wrote         boolean not null default false,
  reason        text,
  coverage      numeric,
  matched       integer,
  observed      integer,
  warnings      jsonb,
  held          jsonb,          -- large moves awaiting corroboration
  retired       jsonb,
  price_card_version text,
  error         text
);

create index if not exists qci_refresh_runs_started_idx
  on public.qci_refresh_runs (started_at desc);

alter table public.qci_refresh_runs enable row level security;

drop policy if exists "qci_refresh_runs: authenticated read" on public.qci_refresh_runs;
create policy "qci_refresh_runs: authenticated read"
  on public.qci_refresh_runs for select
  to authenticated
  using (true);
