// ──────────────────────────────────────────────────────────────────────────────
// Quandela — REAL integration (Quandela Cloud photonic hardware).
//
// Credential: a single API token generated at cloud.quandela.com. Sent as
// `Authorization: Bearer <token>`. API host is api.cloud.quandela.com (the
// cloud.quandela.com domain is the web dashboard, NOT the API).
//
// Quandela's cloud has NO list-all endpoint, so we probe known platform names:
//   GET /api/platforms/{name}/processor        (new; falls back to
//   GET /api/platform/{name}                    legacy on 404)
// A platform payload is { status, type, specs.constraints, perfs } — shape
// confirmed against the Perceval SDK (remote_processor.fetch_data). Photonic
// hardware has no qubit count, no quantum-volume, and no price in the API, so:
//   • capacity   ← specs.constraints.max_mode_count (photonic "width")
//   • fid2q      ← perfs HOM/indistinguishability (closest analogue), scanned
//                  tolerantly because the exact key varies ("HOM", "HOM (%)"…).
//   • qv/clops/price keep documented representative values.
// Only physical QPUs (not simulators) feed the index.
//
// Source: Quandela/Perceval SDK (remote_config.py, rpc_handler.py, remote_processor.py).
// ──────────────────────────────────────────────────────────────────────────────

import type { RawQpuMetrics } from "@/lib/qci/types";
import type { ProviderAdapter, ProviderTestResult } from "./types";

const QUANDELA_API = (process.env.QUANDELA_API_BASE || "https://api.cloud.quandela.com").replace(
  /\/+$/,
  "",
);

// No list-all endpoint exists — platforms are fetched by name. Update these as
// Quandela publishes/renames platforms (the dashboard shows the current set), or
// set QUANDELA_PLATFORMS="qpu:foo,qpu:bar" to add names without a redeploy.
const ENV_PLATFORMS = (process.env.QUANDELA_PLATFORMS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const DEFAULT_QPUS = ["qpu:belenos", "qpu:ascella", "qpu:altair"];
const QUANDELA_QPUS = [...new Set([...DEFAULT_QPUS, ...ENV_PLATFORMS.filter((p) => /^qpu:/i.test(p))])];
const QUANDELA_SIMS = ["sim:belenos", "sim:slos", "sim:ascella", "sim:altair"];
const QUANDELA_ALL = [...new Set([...QUANDELA_QPUS, ...QUANDELA_SIMS, ...ENV_PLATFORMS])];

// The API returns neither pricing nor a quantum-volume figure for photonic
// hardware, so those keep documented representative values; live calls refine
// capacity (mode count) and the fidelity analogue (HOM indistinguishability).
const QUANDELA_PRICE_PER_SHOT = 0.0014;
const QUANDELA_QV = 80;
const QUANDELA_CLOPS = 700;
const QUANDELA_DEFAULT_FID2Q = 0.974;

interface QuandelaPlatform {
  name: string;
  status?: string;
  type?: string;
  specs?: {
    constraints?: {
      max_mode_count?: number;
      max_photon_count?: number;
    };
  };
  perfs?: Record<string, number>;
}

/** Stored credential is either a raw token or a JSON object { token }. */
function parseToken(apiKey: string): string | null {
  const raw = (apiKey ?? "").trim();
  if (!raw) return null;
  try {
    const c = JSON.parse(raw);
    if (c && typeof c === "object" && c.token) return String(c.token).trim();
  } catch {
    /* not JSON → treat the whole value as the token */
  }
  return raw;
}

/**
 * Fetch one platform's detail. Tries the new endpoint, then the legacy path.
 * Returns null if the platform isn't found; throws on an auth failure so callers
 * can surface a bad token.
 */
async function fetchPlatform(token: string, name: string): Promise<QuandelaPlatform | null> {
  const headers = { Accept: "application/json", Authorization: `Bearer ${token}` };
  const encoded = encodeURIComponent(name);
  const paths = [`/api/platforms/${encoded}/processor`, `/api/platform/${encoded}`];
  for (const path of paths) {
    const res = await fetch(`${QUANDELA_API}${path}`, { headers });
    if (res.status === 401 || res.status === 403) {
      throw new Error("Quandela auth failed — check the Cloud API token.");
    }
    if (!res.ok) continue; // 404 etc. → try the legacy path / give up
    try {
      const j = (await res.json()) as Omit<QuandelaPlatform, "name">;
      return { name, ...j };
    } catch {
      return { name };
    }
  }
  return null;
}

function displayName(platformName: string): string {
  const bare = platformName.replace(/^(qpu|sim):/i, "");
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

/**
 * Pull a HOM / single-photon indistinguishability figure from `perfs` without
 * assuming the exact key (Quandela has used "HOM", "HOM (%)", "indistinguishability").
 * Accepts a 0–1 fraction or a 0–100 percentage. Returns null if none is present.
 */
function extractHomFidelity(perfs?: Record<string, number>): number | null {
  if (!perfs) return null;
  for (const [k, v] of Object.entries(perfs)) {
    if (typeof v !== "number") continue;
    const key = k.toLowerCase();
    if (key.includes("hom") || key.includes("indistinguish")) {
      const f = v > 1 ? v / 100 : v; // percentage → fraction
      if (f > 0 && f <= 1) return Math.max(0, Math.min(0.9999, f));
    }
  }
  return null;
}

function mapPlatformToMetrics(p: QuandelaPlatform): RawQpuMetrics {
  const c = p.specs?.constraints;
  const capacity = Number(c?.max_mode_count ?? c?.max_photon_count ?? 12) || 12;
  const fid2q = extractHomFidelity(p.perfs) ?? QUANDELA_DEFAULT_FID2Q;
  return {
    provider: "Quandela",
    qpu: displayName(p.name),
    rawPrice: QUANDELA_PRICE_PER_SHOT,
    unit: "per_shot",
    qv: QUANDELA_QV,
    clops: QUANDELA_CLOPS,
    fid2q,
    capacity,
  };
}

export const quandela: ProviderAdapter = {
  id: "quandela",
  name: "Quandela",
  description: "Photonic quantum computing via Quandela Cloud.",
  docsUrl: "https://cloud.quandela.com/",
  keyPlaceholder: "Quandela Cloud API token",
  covers: ["Quandela Belenos"],
  testable: true,
  fields: [{ key: "token", label: "Quandela Cloud API token", type: "password" }],

  async fetchMetrics(apiKey: string): Promise<RawQpuMetrics[]> {
    const token = parseToken(apiKey);
    if (!token) return [];
    // Only physical QPUs feed the index (simulators aren't priced compute).
    const platforms = await Promise.all(
      QUANDELA_QPUS.map(async (name) => {
        try {
          return await fetchPlatform(token, name);
        } catch {
          return null; // auth/network error → contribute nothing this run
        }
      }),
    );
    return platforms
      .filter((p): p is QuandelaPlatform => p !== null)
      .map(mapPlatformToMetrics);
  },

  async testConnection(apiKey: string): Promise<ProviderTestResult> {
    const token = parseToken(apiKey);
    if (!token) return { ok: false, message: "Enter your Quandela Cloud API token." };
    try {
      const probed = await Promise.all(
        QUANDELA_ALL.map(async (name) => {
          const p = await fetchPlatform(token, name); // auth error rejects → outer catch
          return { name, status: p?.status ?? null, found: p !== null };
        }),
      );
      const found = probed.filter((p) => p.found);
      if (found.length === 0) {
        return {
          ok: true,
          message:
            "Token accepted, but none of the known Quandela platforms responded — they may have been renamed. Check the dashboard.",
        };
      }
      const details = found.map((p) => `${p.name} — ${p.status ?? "available"}`);
      return {
        ok: true,
        message: `Connected to Quandela Cloud. Reached ${found.length} of ${QUANDELA_ALL.length} known platform(s).`,
        details,
      };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "Connection failed." };
    }
  },
};
