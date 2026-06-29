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

## Tech stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js (App Router) + TypeScript |
| Styling | Tailwind CSS (glassmorphism) + framer-motion |
| Chart | TradingView `lightweight-charts` |
| Auth + DB | Supabase (Postgres, Auth with Google, Row-Level Security) |
| Hosting + Cron | Vercel |

---

## Do I need a separate backend or Supabase Edge Functions?

**No — there is nothing extra to stand up.** Here is the entire architecture:

- **Supabase** = your database + login. You paste **one** SQL file into it. That's the whole DB setup.
- **The Next.js app (on Vercel)** = the website **and** the calculation engine. The QCI math runs
  inside the app as a serverless function — **no separate server, no Supabase Edge Functions, no Python service.**
- **Vercel Cron** calls that function once a day at **9:30 AM ET** to recompute and save the index. It's
  already configured in [`vercel.json`](vercel.json) and turns itself on when you deploy.

So your only jobs are: paste the SQL, switch on Google login, set a few env vars, deploy. The checklist does it.

## Setup checklist (the easy version)

- [ ] **1. Paste the database.** Supabase → **SQL Editor** → paste all of [`supabase/schema.sql`](supabase/schema.sql) → **Run**. This creates every table, security rule, and the daily-data plumbing in one shot.
- [ ] **2. Say who can log in.** In the same SQL editor, run this (change the email), once per person:
      ```sql
      insert into public.allowed_emails (email) values ('you@example.com');
      ```
      Only emails in this list can sign in; everyone else is bounced to an "invite-only" page.
- [ ] **3. Turn on Google login.** Supabase → **Authentication → Providers → Google** (the Google Cloud half is in [§ Google sign-in](#3-google-sign-in) below).
- [ ] **4. Copy 3 keys** from Supabase → **Project Settings → API** into your env vars:
      `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- [ ] **5. Make up 2 secrets** (any long random strings) — `KEY_ENCRYPTION_SECRET` and `CRON_SECRET`. Tip: `openssl rand -base64 32` prints one.
- [ ] **6. Deploy to Vercel.** Import the GitHub repo, paste all the env vars, deploy. The daily cron registers itself automatically.
- [ ] **7. (When ready) add provider API keys** inside the app: sign in → **Dashboard → Settings** → paste a key. The index goes live on the next daily run.

That's the entire backend. No edge functions, no extra services to run or pay for.

### Run the calculation on demand (optional)
The daily job fires at 9:30 AM ET on its own. To recompute immediately:
```bash
curl -X POST "https://YOUR-SITE/api/cron/refresh?force=true" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```
Until at least one provider key is added, the app shows clearly-labeled **sample data** and the job writes
nothing real — so everything is safe to click before you have keys.

---

## 1. Run locally

```bash
npm install
cp .env.local.example .env.local   # fill in values (see below)
npm run dev                         # http://localhost:3000
```

The landing page works immediately with **sample data** even before Supabase is
configured. Sign-in and the dashboard require the Supabase steps below.

## 2. Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query** → paste all of [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
   This creates the tables, Row-Level Security, the allowlist trigger, and profile automation.
3. Add the people who may sign in (SQL Editor or Table Editor → `allowed_emails`):
   ```sql
   insert into public.allowed_emails (email, added_by)
   values ('you@example.com', 'founder')
   on conflict (email) do nothing;
   ```
4. **Project Settings → API** → copy `Project URL`, `anon public` key, and `service_role` key into `.env.local`.

## 3. Google sign-in

1. In **Google Cloud Console** → *APIs & Services → Credentials* → create an **OAuth client ID** (type: Web application).
2. Under *Authorized redirect URIs* add your Supabase callback:
   `https://<your-project-ref>.supabase.co/auth/v1/callback`
3. In **Supabase → Authentication → Providers → Google**: enable it and paste the Google **Client ID** and **Client Secret**.
4. In **Supabase → Authentication → URL Configuration**:
   - *Site URL*: `http://localhost:3000` (and your production URL later)
   - *Redirect URLs*: add `http://localhost:3000/auth/callback` and `https://your-domain.vercel.app/auth/callback`

Now only emails in `allowed_emails` can sign in — anyone else lands on `/access-denied`.

## 4. Environment variables

Set these in `.env.local` (local) and in **Vercel → Project → Settings → Environment Variables** (production):

| Variable | Description |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key — **server only**, used by cron + key decryption |
| `KEY_ENCRYPTION_SECRET` | 32+ char secret to encrypt provider keys at rest (`openssl rand -base64 32`) |
| `CRON_SECRET` | Secret the daily cron uses to authenticate (`openssl rand -base64 32`) |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` locally, your domain in prod |

## 5. Deploy to Vercel

1. Push this repo to GitHub.
2. Import it at [vercel.com/new](https://vercel.com/new).
3. Add all environment variables above.
4. Deploy. The cron in [`vercel.json`](vercel.json) registers automatically.

> **Cron + DST:** the job fires at 13:30 **and** 14:30 UTC; the handler runs the
> computation only when New York local time is 9:30 AM, so it stays correct across
> daylight-saving changes and writes at most one live snapshot per day.

Test the refresh manually:
```bash
curl -X POST "https://your-domain.vercel.app/api/cron/refresh?force=true" \
  -H "Authorization: Bearer $CRON_SECRET"
```

---

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

## Project structure

```
src/
  app/            landing, access-denied, dashboard (overview + settings), api routes, auth
  components/     AnimatedTitle, PriceDisplay, PriceChart, SignInButton, ProviderKeyForm, …
  lib/qci/        the QCI engine (formula, normalize, marketAdjust, seed, sample, compute, store)
  lib/providers/  per-provider adapters + registry
  lib/supabase/   browser / server / admin clients
  lib/crypto.ts   AES-256-GCM encryption for provider keys
  middleware.ts   session refresh + /dashboard protection
supabase/schema.sql   run this in the Supabase SQL editor
vercel.json           daily cron schedule
```

## Security notes

- Provider API keys are encrypted (AES-256-GCM) before storage and only decrypted
  server-side during the cron run. They are never returned to the browser.
- Sign-in is blocked at the database level (allowlist trigger on `auth.users`).
- `qci_snapshots` is publicly readable (the index price is public); everything else
  is gated by Row-Level Security.
- The `service_role` key and `KEY_ENCRYPTION_SECRET` must only ever be set as
  server-side environment variables — never expose them to the client.
