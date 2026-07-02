// ──────────────────────────────────────────────────────────────────────────────
// IQM — REAL integration (IQM Resonance cloud, iqm.tech).
//
// Credential: a single API token generated in the Resonance dashboard
// ("Generate token" — shown once). Sent as `Authorization: Bearer <token>`.
//
// The list response is thin (id + alias only), so this is an N+1 pull:
//   1. GET /api/v1/quantum-computers                         → [{ id, alias }]
//   2. per device  GET .../{alias}/health                    → online?
//   3. per device  GET .../{alias}/artifacts/static-quantum-architectures
//                                                            → qubit count
//   4. per device  GET /api/v1/calibration-sets/{alias}/default/metrics
//                                                            → 2-qubit fidelity
//
// Resonance is credit/quota based and does NOT return pricing via the API, so we
// use the same published Braket-IQM per-shot list rate the AWS adapter uses, and
// emit provider:"IQM" so the index COLLAPSES this with any Braket-sourced IQM
// entry (see collapseOnePerProvider) rather than double-counting.
//
// Base host: https://resonance.iqm.tech (alias: resonance.meetiqm.com).
// Source: iqm-client SDK (github.com/iqm-finland/sdk).
// Docs:   https://docs.iqm.tech/iqm-client/
// ──────────────────────────────────────────────────────────────────────────────

import type { RawQpuMetrics } from "@/lib/qci/types";
import type { ProviderAdapter, ProviderTestResult } from "./types";

const IQM_API = "https://resonance.iqm.tech/api/v1";
// No price via the Resonance API → published Braket-IQM per-shot list rate.
const IQM_PRICE_PER_SHOT = 0.00145;
const IQM_DEFAULT_CLOPS = 1800;
const IQM_DEFAULT_FID2Q = 0.988;

interface IqmComputer {
  id?: string;
  alias?: string;
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

function authHeaders(token: string): Record<string, string> {
  return { Accept: "application/json", Authorization: `Bearer ${token}` };
}

async function listComputers(token: string): Promise<IqmComputer[]> {
  const res = await fetch(`${IQM_API}/quantum-computers`, { headers: authHeaders(token) });
  if (res.status === 401 || res.status === 403) {
    throw new Error("IQM auth failed — check the Resonance API token.");
  }
  if (!res.ok) throw new Error(`IQM list request failed (${res.status}).`);
  const j = (await res.json()) as { quantum_computers?: IqmComputer[] };
  return Array.isArray(j.quantum_computers) ? j.quantum_computers : [];
}

async function isOnline(token: string, alias: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${IQM_API}/quantum-computers/${encodeURIComponent(alias)}/health`,
      { headers: authHeaders(token) },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** Qubit count from the static architecture artifact (len of the qubits list). */
async function qubitCount(token: string, alias: string): Promise<number> {
  try {
    const res = await fetch(
      `${IQM_API}/quantum-computers/${encodeURIComponent(alias)}/artifacts/static-quantum-architectures`,
      { headers: authHeaders(token) },
    );
    if (!res.ok) return 0;
    const j = (await res.json()) as { qubits?: unknown[] };
    return Array.isArray(j.qubits) ? j.qubits.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Best-effort median two-qubit gate fidelity from the default calibration set.
 * The exact metric key isn't stable across calibration sets, so we scan the
 * observations for a two-qubit gate fidelity; caller defaults if none is found.
 */
function extractTwoQFidelity(node: unknown): number | null {
  let best: number | null = null;
  const visit = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    const o = v as Record<string, unknown>;
    const name = String(
      o.observation_name ?? o.name ?? o.metric ?? o.dut_field ?? o.key ?? "",
    ).toLowerCase();
    const value = o.value ?? o.mean ?? o.average;
    if (
      typeof value === "number" &&
      name.includes("fidelity") &&
      /(two|2q|2-q|cz|move|gate2)/.test(name)
    ) {
      const f = value > 1 ? value / 100 : value; // accept 0-1 or percentage
      if (f > 0 && f <= 1) best = best === null ? f : Math.max(best, f);
    }
    Object.values(o).forEach(visit);
  };
  visit(node);
  return best;
}

async function twoQubitFidelity(token: string, alias: string): Promise<number | null> {
  try {
    const res = await fetch(
      `${IQM_API}/calibration-sets/${encodeURIComponent(alias)}/default/metrics`,
      { headers: authHeaders(token) },
    );
    if (!res.ok) return null;
    return extractTwoQFidelity(await res.json());
  } catch {
    return null;
  }
}

export const iqm: ProviderAdapter = {
  id: "iqm",
  name: "IQM",
  description: "Garnet-class superconducting QPUs via IQM Resonance.",
  docsUrl: "https://resonance.iqm.tech/",
  keyPlaceholder: "IQM Resonance API token",
  covers: ["IQM"],
  testable: true,
  fields: [{ key: "token", label: "IQM Resonance API token", type: "password" }],

  async fetchMetrics(apiKey: string): Promise<RawQpuMetrics[]> {
    const token = parseToken(apiKey);
    if (!token) return [];
    const computers = await listComputers(token);
    const metrics = await Promise.all(
      computers.map(async (c): Promise<RawQpuMetrics | null> => {
        const alias = c.alias;
        if (!alias) return null;
        if (!(await isOnline(token, alias))) return null;
        const [qubits, fid] = await Promise.all([
          qubitCount(token, alias),
          twoQubitFidelity(token, alias),
        ]);
        const capacity = qubits || 20;
        return {
          provider: "IQM",
          qpu: alias,
          rawPrice: IQM_PRICE_PER_SHOT,
          unit: "per_shot",
          qv: Math.pow(2, Math.min(capacity, 20)),
          clops: IQM_DEFAULT_CLOPS,
          fid2q: fid ?? IQM_DEFAULT_FID2Q,
          capacity,
        };
      }),
    );
    return metrics.filter((m): m is RawQpuMetrics => m !== null);
  },

  async testConnection(apiKey: string): Promise<ProviderTestResult> {
    const token = parseToken(apiKey);
    if (!token) return { ok: false, message: "Enter your IQM Resonance API token." };
    try {
      const computers = await listComputers(token);
      const statuses = await Promise.all(
        computers.map(async (c) => ({
          alias: c.alias ?? c.id ?? "?",
          online: c.alias ? await isOnline(token, c.alias) : false,
        })),
      );
      const up = statuses.filter((s) => s.online).length;
      const details = statuses
        .slice(0, 12)
        .map((s) => `${s.alias} — ${s.online ? "online" : "unavailable"}`);
      return {
        ok: true,
        message: `Connected to IQM Resonance. Found ${computers.length} quantum computer(s), ${up} online.`,
        details,
      };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "Connection failed." };
    }
  },
};
