// ──────────────────────────────────────────────────────────────────────────────
// IQM — REAL integration (IQM Resonance cloud, iqm.tech).
//
// Credential: a single API token generated in the Resonance dashboard
// ("Generate token" — shown once). Sent as `Authorization: Bearer <token>`.
// (Verified live: the base + /quantum-computers endpoint returns a structured
// `401 unauthorized` JSON when unauthenticated, so bearer-only is correct — the
// token is org-scoped and no separate workspace id is needed.)
//
// The list response is thin (id + alias only), so this is an N+1 pull:
//   1. GET /api/v1/quantum-computers                         → [{ id, alias }]
//   2. per device  GET .../{alias}/health                    → status (advisory)
//   3. per device  GET .../{alias}/artifacts/static-quantum-architectures
//                                                            → qubit count
//   4. per device  GET /api/v1/calibration-sets/{alias}/default/metrics
//                                                            → 2-qubit fidelity
//
// DESIGN: every step past the auth'd listing FAILS OPEN. A device that lists is
// part of the fleet, so we always emit a metric for it (real price + real qubit
// count where the sub-calls succeed, provider-typical defaults otherwise) and
// only drop a device whose health explicitly reports it down. A slightly-off
// sub-endpoint shape therefore degrades a single field — it never silently zeros
// out the whole provider.
//
// Resonance is credit/quota based and does NOT return pricing via the API, so we
// use the same published Braket-IQM per-shot list rate the AWS adapter uses, and
// emit provider:"IQM" so the index COLLAPSES this with any Braket-sourced IQM
// entry (see collapseOnePerProvider) rather than double-counting.
//
// Base host: https://resonance.iqm.tech (override with IQM_API_BASE if IQM moves
// it, e.g. https://api.resonance.meetiqm.com). Source: iqm-client SDK.
// Docs: https://docs.iqm.tech/iqm-client/
// ──────────────────────────────────────────────────────────────────────────────

import type { RawQpuMetrics } from "@/lib/qci/types";
import type { ProviderAdapter, ProviderTestResult } from "./types";

const IQM_API = (process.env.IQM_API_BASE || "https://resonance.iqm.tech").replace(/\/+$/, "") + "/api/v1";
// No price via the Resonance API → published Braket-IQM per-shot list rate.
const IQM_PRICE_PER_SHOT = 0.00145;
const IQM_DEFAULT_CLOPS = 1800;
const IQM_DEFAULT_FID2Q = 0.988;
const IQM_DEFAULT_QUBITS = 20;

interface IqmComputer {
  id?: string;
  alias?: string;
  name?: string;
}

type DeviceStatus = "online" | "offline" | "unknown";

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

/** A device's routing key on the Resonance API (alias preferred, then id/name). */
function deviceKey(c: IqmComputer): string | null {
  const k = c.alias ?? c.id ?? c.name;
  return k ? String(k) : null;
}

/**
 * List the account's quantum computers. Tolerant of the exact envelope the API
 * uses (`quantum_computers`, `data`, `items`, `results`, or a bare array).
 */
async function listComputers(token: string): Promise<IqmComputer[]> {
  const res = await fetch(`${IQM_API}/quantum-computers`, { headers: authHeaders(token) });
  if (res.status === 401 || res.status === 403) {
    throw new Error("IQM auth failed — check the Resonance API token.");
  }
  if (!res.ok) throw new Error(`IQM list request failed (${res.status}).`);
  const j = (await res.json()) as unknown;
  const list = Array.isArray(j)
    ? j
    : ((j as Record<string, unknown>)?.quantum_computers ??
        (j as Record<string, unknown>)?.data ??
        (j as Record<string, unknown>)?.items ??
        (j as Record<string, unknown>)?.results ??
        []);
  return Array.isArray(list) ? (list as IqmComputer[]) : [];
}

/**
 * Advisory health check. FAILS OPEN: a non-2xx response or unreadable body →
 * "unknown" (device kept), and we only report "offline" when the body clearly
 * says so. This prevents a wrong health path from zeroing out the provider.
 */
async function deviceStatus(token: string, key: string): Promise<DeviceStatus> {
  try {
    const res = await fetch(
      `${IQM_API}/quantum-computers/${encodeURIComponent(key)}/health`,
      { headers: authHeaders(token) },
    );
    if (!res.ok) return "unknown";
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      return "online"; // reachable, no parseable status → treat as up
    }
    const s = JSON.stringify(body).toLowerCase();
    if (/(offline|maintenance|"down"|unavailable|inactive|retired)/.test(s)) return "offline";
    return "online";
  } catch {
    return "unknown";
  }
}

/** Qubit count from the static architecture artifact (len of the qubits list). */
async function qubitCount(token: string, key: string): Promise<number> {
  try {
    const res = await fetch(
      `${IQM_API}/quantum-computers/${encodeURIComponent(key)}/artifacts/static-quantum-architectures`,
      { headers: authHeaders(token) },
    );
    if (!res.ok) return 0;
    const j = (await res.json()) as Record<string, unknown>;
    // Accept a few shapes: { qubits: [...] } | { qubit_count } | nested arch.
    const arch = (j.quantum_architecture ?? j.architecture ?? j) as Record<string, unknown>;
    const qubits = arch?.qubits ?? j.qubits;
    if (Array.isArray(qubits)) return qubits.length;
    const n = Number(arch?.qubit_count ?? j.qubit_count ?? j.number_of_qubits);
    return Number.isFinite(n) && n > 0 ? n : 0;
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

async function twoQubitFidelity(token: string, key: string): Promise<number | null> {
  try {
    const res = await fetch(
      `${IQM_API}/calibration-sets/${encodeURIComponent(key)}/default/metrics`,
      { headers: authHeaders(token) },
    );
    if (!res.ok) return null;
    return extractTwoQFidelity(await res.json());
  } catch {
    return null;
  }
}

/** Enrich one listed device into a metric (fail-open on every sub-call). */
async function deviceToMetrics(
  token: string,
  c: IqmComputer,
): Promise<RawQpuMetrics | null> {
  const key = deviceKey(c);
  if (!key) return null;
  const [status, qubits, fid] = await Promise.all([
    deviceStatus(token, key),
    qubitCount(token, key),
    twoQubitFidelity(token, key),
  ]);
  if (status === "offline") return null; // only drop when explicitly down
  const capacity = qubits || IQM_DEFAULT_QUBITS;
  return {
    provider: "IQM",
    qpu: c.alias ?? c.name ?? key,
    rawPrice: IQM_PRICE_PER_SHOT,
    unit: "per_shot",
    qv: Math.pow(2, Math.min(capacity, 20)),
    clops: IQM_DEFAULT_CLOPS,
    fid2q: fid ?? IQM_DEFAULT_FID2Q,
    capacity,
  };
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
    const metrics = await Promise.all(computers.map((c) => deviceToMetrics(token, c)));
    return metrics.filter((m): m is RawQpuMetrics => m !== null);
  },

  async testConnection(apiKey: string): Promise<ProviderTestResult> {
    const token = parseToken(apiKey);
    if (!token) return { ok: false, message: "Enter your IQM Resonance API token." };
    try {
      const computers = await listComputers(token);
      const statuses = await Promise.all(
        computers.map(async (c) => {
          const key = deviceKey(c);
          return {
            name: c.alias ?? c.name ?? key ?? "?",
            status: key ? await deviceStatus(token, key) : "unknown",
          };
        }),
      );
      const up = statuses.filter((s) => s.status !== "offline").length;
      const details = statuses
        .slice(0, 12)
        .map((s) => `${s.name} — ${s.status}`);
      return {
        ok: true,
        message: `Connected to IQM Resonance. Found ${computers.length} quantum computer(s), ${up} available.`,
        details,
      };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "Connection failed." };
    }
  },
};
