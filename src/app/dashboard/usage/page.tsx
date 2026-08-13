import Link from "next/link";
import { Activity, Coins, Cpu, Timer } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getBackend } from "@/lib/qrouter/catalog";
import UsageRangeTabs from "@/components/console/UsageRangeTabs";

// ─────────────────────────────────────────────────────────────────────────────
// Usage — what the workspace actually spent and ran.
//
// This tab did not exist; the sidebar linked to a 404. Everything here comes
// from tables the console already writes: `jobs` for volume and duration,
// `quotes` for what each job cost, `credit_accounts` for what is left. Reads go
// through the user's own session so RLS ("job member read") scopes them to the
// caller's organization — there is no admin client on this path.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";
export const metadata = { title: "QRouter Console — Usage" };

const RANGES = { "7d": 7, "30d": 30, "90d": 90 } as const;
type RangeKey = keyof typeof RANGES;

/** Job statuses grouped into the three colours the console is allowed to use. */
const SUCCEEDED = new Set(["completed"]);
const FAILED = new Set(["failed", "cancelled"]);

interface JobRow {
  id: string;
  status: string;
  shots: number | null;
  selected_backend_id: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  quotes: { total: number | string }[] | { total: number | string } | null;
}

function quoteTotal(row: JobRow): number {
  const quote = Array.isArray(row.quotes) ? row.quotes[0] : row.quotes;
  return quote ? Number(quote.total) || 0 : 0;
}

/** "1.4s" / "2m 30s" / "1h 12m" — same formatting the Activity table uses. */
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: rawRange } = await searchParams;
  const range: RangeKey = rawRange === "7d" || rawRange === "90d" ? rawRange : "30d";
  const days = RANGES[range];
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  let jobs: JobRow[] = [];
  let available = 0;
  let reserved = 0;
  let configured = false;

  if (isSupabaseConfigured()) {
    configured = true;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: member } = await supabase
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      if (member) {
        const [jobsResult, creditsResult] = await Promise.all([
          supabase
            .from("jobs")
            .select("id,status,shots,selected_backend_id,created_at,started_at,completed_at,quotes!job_id(total)")
            .eq("organization_id", member.organization_id)
            .gte("created_at", since.toISOString())
            .order("created_at", { ascending: false })
            .limit(2000),
          supabase
            .from("credit_accounts")
            .select("available,reserved")
            .eq("organization_id", member.organization_id)
            .maybeSingle(),
        ]);
        jobs = (jobsResult.data ?? []) as JobRow[];
        available = Number(creditsResult.data?.available ?? 0);
        reserved = Number(creditsResult.data?.reserved ?? 0);
      }
    }
  }

  // ── Aggregates ───────────────────────────────────────────────────────────
  const spend = jobs.reduce((sum, job) => sum + quoteTotal(job), 0);
  const shots = jobs.reduce((sum, job) => sum + (job.shots ?? 0), 0);
  const succeeded = jobs.filter((job) => SUCCEEDED.has(job.status)).length;
  const failed = jobs.filter((job) => FAILED.has(job.status)).length;
  const inFlight = jobs.length - succeeded - failed;
  const settled = succeeded + failed;
  const successRate = settled > 0 ? (succeeded / settled) * 100 : null;

  const durations = jobs
    .filter((job) => job.completed_at)
    .map((job) => new Date(job.completed_at!).getTime() - new Date(job.started_at ?? job.created_at).getTime())
    .filter((ms) => Number.isFinite(ms) && ms >= 0);
  const medianDuration = durations.length
    ? [...durations].sort((a, b) => a - b)[Math.floor(durations.length / 2)]
    : null;

  // Daily buckets, oldest first, with empty days kept so the chart has a
  // continuous time axis rather than only the days that happened to have runs.
  const buckets = new Map<string, { jobs: number; spend: number }>();
  for (let index = days - 1; index >= 0; index -= 1) {
    buckets.set(dayKey(new Date(Date.now() - index * 24 * 60 * 60 * 1000).toISOString()), { jobs: 0, spend: 0 });
  }
  for (const job of jobs) {
    const bucket = buckets.get(dayKey(job.created_at));
    if (!bucket) continue;
    bucket.jobs += 1;
    bucket.spend += quoteTotal(job);
  }
  const series = [...buckets.entries()];
  const peak = Math.max(1, ...series.map(([, value]) => value.jobs));

  // Per-backend rollup, most-used first.
  const byBackend = new Map<string, { jobs: number; shots: number; spend: number }>();
  for (const job of jobs) {
    const id = job.selected_backend_id ?? "unrouted";
    const entry = byBackend.get(id) ?? { jobs: 0, shots: 0, spend: 0 };
    entry.jobs += 1;
    entry.shots += job.shots ?? 0;
    entry.spend += quoteTotal(job);
    byBackend.set(id, entry);
  }
  const backends = [...byBackend.entries()].sort((a, b) => b[1].jobs - a[1].jobs).slice(0, 10);

  return (
    <div className="console-page">
      <div className="console-page-heading compact">
        <div>
          <h1>Usage</h1>
        </div>
        <UsageRangeTabs current={range} />
      </div>

      {!configured && (
        <p className="usage-notice">
          Local preview — connect Supabase to see this workspace&apos;s real usage.
        </p>
      )}

      <section className="usage-stats" aria-label="Usage summary">
        <div>
          <span>
            <Activity size={13} /> Jobs
          </span>
          <b>{jobs.length.toLocaleString()}</b>
          <small>
            <i className="dot ok" /> {succeeded} done <i className="dot warn" /> {inFlight} running{" "}
            <i className="dot bad" /> {failed} failed
          </small>
        </div>
        <div>
          <span>
            <Cpu size={13} /> Shots executed
          </span>
          <b>{shots.toLocaleString()}</b>
          <small>{backends.length} backend{backends.length === 1 ? "" : "s"} used</small>
        </div>
        <div>
          <span>
            <Coins size={13} /> Spend
          </span>
          <b>${spend.toFixed(2)}</b>
          <small>
            ${available.toFixed(2)} available{reserved > 0 ? ` · $${reserved.toFixed(2)} reserved` : ""}
          </small>
        </div>
        <div>
          <span>
            <Timer size={13} /> Median run
          </span>
          <b>{medianDuration === null ? "—" : formatDuration(medianDuration)}</b>
          <small>
            {successRate === null ? "no settled jobs yet" : `${successRate.toFixed(0)}% success rate`}
          </small>
        </div>
      </section>

      <section className="console-panel usage-chart-panel">
        <div className="panel-title">
          <Activity size={16} />
          <div>
            <h2>Jobs per day</h2>
            <small>Last {days} days</small>
          </div>
          <span>${spend.toFixed(2)} total</span>
        </div>
        {jobs.length === 0 ? (
          <div className="console-empty">
            <Activity />
            <p>No jobs in this period</p>
            <Link href="/dashboard">Run your first job</Link>
          </div>
        ) : (
          <div className="usage-chart" role="img" aria-label={`Jobs per day over the last ${days} days`}>
            {series.map(([day, value]) => (
              <div
                key={day}
                className={value.jobs > 0 ? "has-jobs" : ""}
                title={`${day} · ${value.jobs} job${value.jobs === 1 ? "" : "s"} · $${value.spend.toFixed(4)}`}
              >
                <i style={{ height: `${(value.jobs / peak) * 100}%` }} />
              </div>
            ))}
          </div>
        )}
        <div className="usage-chart-axis">
          <span>{series[0]?.[0]}</span>
          <span>{series[series.length - 1]?.[0]}</span>
        </div>
      </section>

      <section className="console-panel usage-backend-panel">
        <div className="panel-title">
          <Cpu size={16} />
          <div>
            <h2>By backend</h2>
            <small>Where the work went</small>
          </div>
          <span>{byBackend.size} total</span>
        </div>
        <div className="usage-backend-head">
          <span>Backend</span>
          <span>Jobs</span>
          <span>Shots</span>
          <span>Spend</span>
          <span>Share</span>
        </div>
        {backends.length === 0 ? (
          <div className="console-empty">
            <Cpu />
            <p>No routed jobs yet</p>
          </div>
        ) : (
          backends.map(([id, value]) => (
            <div className="usage-backend-row" key={id}>
              <span>
                <b>{getBackend(id)?.displayName ?? id}</b>
                <small>{id}</small>
              </span>
              <span>{value.jobs.toLocaleString()}</span>
              <span>{value.shots.toLocaleString()}</span>
              <span>${value.spend.toFixed(4)}</span>
              <span className="usage-share">
                <i style={{ width: `${(value.jobs / jobs.length) * 100}%` }} />
                <em>{((value.jobs / jobs.length) * 100).toFixed(0)}%</em>
              </span>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
