# QuantumForge Exchange

The financial layer for quantum computing. A web app that publishes the **Quantum
Compute Index (QCI)** — a performance-adjusted benchmark for the price and utility
of an hour of quantum compute across IBM, IonQ, Rigetti, IQM and more — and a gated,
glassmorphism dashboard where approved partners connect quantum-cloud providers that
feed the index.

- **Public landing page** — live QCI price, animated brand identity, about section. No login.
- **Google sign-in, invite-only** — restricted to an email allowlist (Supabase).
- **Dashboard** — current QCI, chart, index constituents, and a Settings tab to paste provider API keys.
- **Daily refresh at 9:30 AM ET** — Vercel Cron computes & stores a new index snapshot.
- **Works before any keys exist** — shows clearly-labeled *sample data*, then auto-switches to live data once a provider key is added.


## How the index works

The QCI implements the formula from *QCI Research 1.1* (Lahoda & Flowers). The math
lives in [`src/lib/qci/`](src/lib/qci/) and is the place to tune the index.

**Base index — PQF-weighted VWAP:**

```
I = Σ(P_trans · V_trans · PQF) / Σ(V_trans · PQF)
```

**Performance Quality Factor per QPU:**

```
PQF_i = α·(log2(QV_i)/log2(QV_base)) + β·(CLOPS_i/CLOPS_base) + γ·F_2q_i
```

The displayed QCI is anchored to **1000 at inception** (S&P-style), computed from the
seed benchmark basket in [`seed.ts`](src/lib/qci/seed.ts).

**Tuning knobs:**
- `formula.ts` — coefficients `α, β, γ` and base constants (`DEFAULT_CONFIG`).
- `normalize.ts` — `$/min` and `$/shot` → Normalized Quantum Hour conversion.
- `marketAdjust.ts` — optional queue / demand / equity overlay (off by default).
- `seed.ts` — the benchmark table used for the inception reference & sample data.

**Documented modeling decisions (see code comments):**
- The index is defined over *transactions*; until a real order book exists, `V_trans`
  uses a documented **volume proxy** (provider capacity × demand).
- Provider prices use different units, normalized to an NQH via explicit assumptions.
- The research table's PQF values are *estimates* (e.g. IonQ AQ); the formula is
  implemented faithfully and the table is used only as seed/defaults.

## Going live with a provider

1. Sign in → **Dashboard → Settings**.
2. Paste an API key for a provider (e.g. AWS Braket, which covers IonQ/Rigetti/IQM).
3. At the next 9:30 AM ET refresh (or a forced run), the cron pulls that provider's
   metrics, computes the live index, and the app switches from sample to **live** data.

> The provider adapters in [`src/lib/providers/`](src/lib/providers/) are scaffolds:
> with a key present they currently return benchmark values with small daily drift so
> the whole pipeline is genuinely live end-to-end. Replace each adapter's `fetchMetrics`
> body with real provider API calls to source true pricing/calibration/queue data.
