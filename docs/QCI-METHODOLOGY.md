# Quantum Compute Index — Methodology (QCI 2.0)

**What it measures:** the quality-adjusted price of one hour of quantum compute, in USD, chain-linked daily across the provider market.

**Version:** `qci-2.0.0` · **Publication clock:** America/New_York · **Inception level:** 1000

---

## 1. Why v1 was replaced

The previous index had five defects that together made the published number untrustworthy. They are worth stating precisely, because each one motivates a specific piece of v2.

### 1.1 No price was ever fetched

Every price in v1 was a literal in a TypeScript file:

```ts
const IBM_PRICE_PER_MIN = 96;            // providers/ibm.ts
const IQM_PRICE_PER_SHOT = 0.00145;      // providers/iqm.ts
rigetti: { perShot: 0.0009, ... }        // providers/braket.ts
```

A price index that never observes a price cannot move on price. What actually moved v1 was two-qubit fidelity jitter and which backends happened to answer that morning — reported as a dollar figure.

### 1.2 Quality was used as a weight instead of a deflator

```
I = Σ(P·V·PQF) / Σ(V·PQF)
```

This is an average price *weighted toward better machines*. So a device improving pulled the index toward that device's own price — up if it was expensive, down if it was cheap. A genuine quality gain showed up as a composition shift with an arbitrary sign.

### 1.3 Composition changes destroyed information

```ts
} else {
  // Composition changed → carry the level over (no artificial jump).
  price = prev.price;
}
```

Correct instinct, wrong remedy: on any composition change the index discarded that day's real price movement for *every* constituent, including the ones that reported normally.

### 1.4 The freeze mechanism had no decay, no limit, and no disclosure

`mergeWithCarryForward` reused a provider's last-known values indefinitely. A provider offline for six months still sat in the basket at full weight, presented as current. Unknown provider names were carried "defensively", so a renamed backend could pin a phantom constituent forever. Nothing published told a reader which days were real.

### 1.5 One representative device per provider

```ts
collapseOnePerProvider()  // max capacity, tie-broken by fidelity
```

When IBM's largest backend went down, the "representative" silently became a *different machine*, and v1 compared it against yesterday's other machine as if it were the same constituent. A maintenance window read as a price move. This was likely the single largest undiagnosed source of the jumps.

Plus: `SHOTS_PER_NQH = 60_000` — a global constant "chosen so the seed providers land in a comparable price band" — made cross-provider prices formally incomparable, since one NQH was a wildly different amount of work on an IBM Heron than on an IonQ Forte. And `sampleSeries()` generated a `mulberry32` pseudo-random walk that rendered as history whenever the database was empty.

---

## 2. The unit

**1 QPU-hour = one hour of exclusive access to one quantum processor.**

This is directly observable. It needs no conversion constant, and both major sources quote it natively:

| Source | What it publishes | Auth |
|---|---|---|
| AWS Braket price list | dedicated **reservation rates in USD/hour** | none |
| IBM Quantum | Pay-As-You-Go **$96/minute** = $5,760/hour | published list rate |

Verified live rates (AWS price list `v20260407184508`):

| Device | USD/hour |
|---|---|
| IonQ Aria-1 / Aria-2 / Forte-1 / Forte-Enterprise-1 | 7,000 |
| Rigetti Ankaa-3 | 5,750 |
| AQT IBEX-Q1 | 4,800 |
| Rigetti Cepheus-1-108Q | 4,100 |
| IQM Emerald | 4,000 |
| IQM Garnet | 3,000 |
| QuEra Aquila | 2,500 |

**Per-shot prices are deliberately NOT converted into hourly rates.** Doing so requires a shots-per-hour assumption, and that assumption is what broke v1. A device with no published hourly rate does not enter the headline index.

---

## 3. Quality adjustment (hedonic)

The index measures the price of *capability*, so price is **deflated** by quality rather than weighted by it:

```
π_d = P_d / q_d        USD per Quantum Capability Unit-hour
```

### 3.1 Effective width

A width-*m*, depth-*m* circuit contains ≈ *m*²/2 two-qubit gates, so expected errors ≈ *m*²·ε₂/2. Requiring at most one expected error:

```
m_d = min( n_d , floor( sqrt(2 / ε₂,d) ) )
```

A device is limited either by how many qubits it has or by how fast its errors accumulate — whichever binds first. This is the standard heuristic behind Quantum Volume (Cross et al., *Phys. Rev. A* **100**, 032328, 2019) and needs only two numbers that **every** vendor publishes: qubit count and median two-qubit error. That is what makes it comparable across superconducting, trapped-ion, neutral-atom and photonic hardware, where no single vendor benchmark (QV, #AQ, CLOPS) exists for all of them.

*m* enters **linearly**, not as 2^m. Quantum Volume is exponential in width; using it raw would let one device exceed the rest of the market by ten orders of magnitude and collapse the index onto a single constituent.

### 3.2 Cobb–Douglas capability

```
q_d = (m_d / m_ref)^α · (f_d / f_ref)^β        α = 0.75, β = 0.25
```

- **Scale-free** — `m_ref` and `f_ref` cancel exactly in the period-over-period ratio, so they cannot bias a move.
- **Log-linear** — `Δln q = α·Δln m + β·Δln f`, which makes the price/quality attribution on the map an *identity*, not an estimate.
- Width carries the larger weight because it decides whether a problem is addressable at all; throughput only decides how many samples you get once it is.

---

## 4. Aggregation: matched-sample Törnqvist chain index

```
ln( I_t / I_{t-1} )  =  Σ_{d ∈ M_t}  w̄_d · ln( π_d,t / π_d,t-1 )

M_t  = devices with a usable observation in BOTH t-1 and t
w̄_d = ½ ( s_d,t-1 + s_d,t )
s_d  = expenditure share ∝ hourly rate
```

This single change fixes defects 1.2, 1.3, 1.5 and most of the observed jumpiness:

- **A device joining or leaving is a non-event.** It simply is not in `M_t`. Its price *level* never enters the index — only its own subsequent *changes* do. Adding a provider can no longer reprice anything.
- **Constants cancel.** Every term is a ratio, so per-modality layer rates and hedonic reference points are provably harmless.
- **Stale data contributes exactly zero**, because an unchanged value gives ln(1) = 0. Missing data cannot manufacture a move.
- Törnqvist is a *superlative* index (Diewert 1976) — exact for a translog cost function, and far less prone to chain drift than a chained Laspeyres.

Devices missing from `M_t` are implicitly imputed with the matched cohort's change. That is the class-mean imputation prescribed by the ILO CPI Manual (2020, ch. 6) and Eurostat's HICP guidance for temporarily unavailable items.

**Weight caps.** Device ≤ 25%, provider ≤ 40%, excess redistributed proportionally. Without the provider cap, four IonQ devices at $7,000/hr would carry over half the index. When the two caps are jointly infeasible, the *device* cap yields and the provider cap holds — the provider cap carries the editorial guarantee that the QCI cannot quietly become a single-vendor tracker.

**The level is never rounded before being carried forward.** v1 rounded to 2dp daily and fed that back into the chain, compounding the error indefinitely.

---

## 5. Missing data — the device ledger

An explicit per-device state machine replaces the freeze mechanism. Its only job is to decide, each day: *may this device contribute a price relative?*

| State | Meaning | Contributes? |
|---|---|---|
| `active` | observed today and last time | yes |
| `linking-in` | first observation, or first after a gap | **no** — level adopted, change never linked |
| `unobserved` | missed today | no — imputed with the cohort |
| `pending-confirmation` | a large move awaiting a second observation | no |
| `retired` | unobserved past 45 days | leaves the basket |

**Re-entry never jumps.** A device returning after an outage links in fresh: its level is adopted so it can anchor tomorrow's relative, but the drift across the gap is not dumped into a single day. The unlinked amount is *recorded* (`unlinkedLogChange`), not discarded — a persistently non-zero total would mean outages are biasing the index.

**Large-move verification.** A single-period headline move above |Δln P| = 0.15 (≈16%) is held for one more observation before it may enter. A genuine rate-card change lands in full, one day late; a one-off parse error never lands at all, because it will not reproduce. Nothing is ever silently rewritten. This threshold sits above plausible rate-card adjustments and far below parse failures, which land orders of magnitude out.

**Quality smoothing.** Calibration data genuinely swings between runs, so the two-qubit error is reduced to a **trailing 7-observation median** before use. A reading outside [1e-5, 0.5] is treated as absent, never as data.

**Coverage is published.** Every point carries `coverage` — the share of basket weight actually re-measured that day — and is labelled `final` or `provisional` (threshold 60%). A thin day is visible rather than being presented with the same confidence as a full one.

---

## 6. The cost side

A separate, clearly-labelled companion series. **Cost factors never move the headline index** — a price index must measure prices, or the number becomes an opaque blend of an observation and a forecast.

```
C_hour = energy + consumables + labour + capital recovery

energy      = powerKW × PUE × electricity price     (live, regional)
consumables = capex × 3% / billable hours           (indexed to industrial-gas PPI)
labour      = capex × 6% / billable hours
capital     = capex × CRF(r, n) / billable hours
CRF(r,n)    = r(1+r)^n / ((1+r)^n − 1)
```

### What the numbers actually say

Superconducting device, $22M capex, 5-year life, 50% billable utilisation, 25 kW at ~8.3¢/kWh:

| Component | USD/hour | Share |
|---|---:|---:|
| Capital recovery | 1,135 | 71% |
| Labour | 301 | 19% |
| Consumables | 151 | 9% |
| **Energy** | **3.13** | **0.2%** |
| **Total** | **1,590** | |

**So: do cooling and energy prices drive the price of quantum compute? No — not today, and not close.** A dilution refrigerator drawing 25 kW costs about two dollars an hour to run, against a list price of $3,000–7,000 an hour. Doubling industrial electricity moves the modelled cost of a QPU-hour by roughly 0.2%.

What sets the floor is **capital recovery** on a multi-million-dollar system that is billable maybe half the time. Since labour and consumables are themselves scaled off capex, ~99.8% of modelled cost traces back to the machine and its utilisation — not to what it consumes while running.

The map draws these nodes **to scale**, so energy renders as a dot next to capital. Building it to imply otherwise would have been the easy thing to do and would have been false. The factors are still tracked live, because the ratios will change as hardware costs fall, and because a reader deserves to see the real magnitude rather than be told it is too small to show.

`energyElasticity = d ln(cost) / d ln(electricity price)` is published exactly — it equals the energy share, since energy enters the total linearly.

---

## 7. Data sources

Every value carries a tier, a citation, and the date the **source** says it was true (not our fetch time).

| Tier | Meaning |
|---|---|
| `primary` | seller's rate card or operator's own telemetry |
| `official` | government / central-bank / statistical-agency series |
| `published` | documented vendor figure, pinned with a citation and review date |
| `modelled` | derived by a documented formula |
| `assumed` | engineering default — **only** for quantities that cancel in the index ratio |

### Verified working, no credentials required

| Source | Data | Real cadence |
|---|---|---|
| [AWS Braket price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBraket/current/index.json) | $/hour, $/shot, $/task | on change (poll daily) |
| [ECB Data Portal](https://data-api.ecb.europa.eu) | USD/EUR reference rate | daily (business days) |
| [Eurostat `nrg_pc_205`](https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nrg_pc_205) | EU industrial electricity | **bi-annual** |
| [US Treasury FiscalData](https://api.fiscaldata.treasury.gov) | discount rate | monthly |

### Free API key required

| Source | Data | Register |
|---|---|---|
| **EIA Open Data v2** | US industrial electricity by state (**monthly**, ~2-month lag) | <https://www.eia.gov/opendata/register.php> → `EIA_API_KEY` |
| **BLS Public Data v2** | PPI industrial gas manufacturing (**monthly**) | <https://data.bls.gov/registrationEngine/> → `BLS_API_KEY` |

Both are optional. Without them the cost model falls back to pinned defaults marked `assumed`, visible as such in the UI.

### Provider credentials (already wired)

IBM (IAM key + instance CRN), IonQ, IQM Resonance, AWS Braket (IAM), Quandela — configured in Settings, stored encrypted. These supply **quality and liveness only**; prices come from the rate cards.

### Honest gaps

- **No helium price feed exists anywhere.** USGS publishes annually; the BLM auctions that once set a public reference price have ended. The consumables term is indexed to the BLS industrial-gas PPI as a documented proxy, not a helium spot price.
- **Azure Quantum retail prices are not usable.** The Azure Retail Prices API only exposes the legacy optimization solvers (`Learn and Develop`, `Performance at Scale`); the QPU providers bill through Marketplace and are absent. Verified, not assumed.
- **Stooq is behind a JS challenge** and is not a viable equity feed.
- **US retail electricity is monthly, EU is bi-annual.** A daily index built on a bi-annual input is not "daily data" for that input. Each factor travels with its own `observedAt`, and the UI shows it.

---

## 8. The basket

**Provider set is unchanged from v1:** IBM, IonQ, IQM, QuEra, AQT, Quandela.

**What changed is the number of models inside them**, because the matched-sample link makes more constituents strictly better:

| Provider | v1 | v2 |
|---|---|---|
| IonQ | 1 | 4 (Aria-1, Aria-2, Forte-1, Forte-Enterprise-1) |
| IQM | 1 | 2 (Garnet, Emerald) |
| IBM | 1 | all online backends (discovered live) |
| QuEra | 1 | 1 (Aquila) |
| AQT | 1 | 1 (IBEX-Q1) |

**Liveness gating is mandatory.** The AWS rate card still lists five decommissioned Rigetti Aspen machines, IonQ Harmony, and the legacy `IonQdevice` at their old, much lower per-shot prices. A device enters only if the registry knows it *and* a provider reported it live in the same run.

### Rigetti — registered, not admitted

Rigetti is in the registry with `inBasket: false`. v1 excluded it because a provider joining used to reprice the index, and Rigetti brings backends online without notice (Cepheus did exactly that). **Under v2 that risk is gone** — a new constituent contributes nothing on the day it appears. Rigetti publishes real reservation rates ($5,750/hr Ankaa-3, $4,100/hr Cepheus-1-108Q), so admitting it is now a pure coverage gain with no discontinuity.

It is left off because changing the provider set is a governance decision, not an implementation detail. Flip `inBasket` to `true` in `src/lib/qci/v2/registry.ts` to admit it.

---

## 9. Operations

```bash
# 1. Apply the migration (Supabase SQL editor)
#    supabase/qci-v2.sql

# 2. Optional free keys
#    EIA_API_KEY=...   BLS_API_KEY=...

# 3. Preview before committing to it — computes live, writes nothing
#    /dashboard/qci/preview

# 4. Daily cron (already scheduled 13:30 UTC in vercel.json)
#    GET /api/cron/refresh
```

Tables: `qci_index_points` (one self-contained row per day, including the ledger that produced it), `qci_observations` (raw inputs with provenance), `qci_factors` (macro inputs with their real effective dates), `qci_refresh_runs` (every attempt, successful or not).

**Every row is self-contained.** Given a row you can re-derive it exactly; given two consecutive rows you can re-derive the move. That is a hard requirement for anything claiming to be a standardised benchmark (IOSCO Principles for Financial Benchmarks, 7 and 11).

**The read path never invents data.** When there are no observations, the UI says so. v1's `sampleSeries()` PRNG walk is not carried into v2.

---

## 10. Changing the methodology

`QCI_METHODOLOGY_VERSION` is stamped on every point. Changing α, β, the weight caps, the verification threshold, or the capability definition changes what the level *means* — bump the version and recompute the series, never in place.
