// ──────────────────────────────────────────────────────────────────────────────
// IonQ — REAL integration (IonQ Quantum Cloud direct API).
//
// Credential: a single API key generated at cloud.ionq.com/settings/keys.
// AUTH: the Authorization header VALUE is `apiKey <key>` — NOT `Bearer <key>`
// (a Bearer header yields 401). Verified against docs.ionq.com + qiskit-ionq.
//
// Flow (no job submission — control-plane reads only):
//   1. GET /v0.3/backends            → [{ backend, qubits, status, characterization_url }]
//   2. per QPU  → the backend's current characterization → fidelity["2q"] + qubits
//
// Getting the CURRENT characterization: the plain
// /v0.3/characterizations/backends/{backend} path returns an ARRAY of ALL
// characterizations, so we prefer each backend's `characterization_url` pointer,
// then the `.../current` sub-path, then fall back to the array (most recent by
// `date`). The fidelity object is only schema-guaranteed to carry `spam`, so
// fidelity["2q"] is read defensively and defaulted if absent. Pricing is NOT
// exposed by the API, so we use AWS Braket's published IonQ list rates:
// Aria $0.03/shot, Forte $0.08/shot.
// We emit provider "IonQ" (the same provider Braket used before it was excluded),
// so the index counts exactly one IonQ device via collapseOnePerProvider.
//
// Docs: https://docs.ionq.com/api-reference
// ──────────────────────────────────────────────────────────────────────────────

import type { RawQpuMetrics } from "@/lib/qci/types";
import type { ProviderAdapter, ProviderTestResult } from "./types";

const IONQ_API = (process.env.IONQ_API_BASE || "https://api.ionq.co").replace(/\/+$/, "") + "/v0.3";
const IONQ_DEFAULT_CLOPS = 500; // IonQ trapped-ion; CLOPS not exposed by the API
const IONQ_DEFAULT_FID2Q = 0.985;
const IONQ_DEFAULT_QUBITS = 25;

/** Published Braket list per-shot rates by hardware family (no price via API). */
const IONQ_PRICE_BY_FAMILY: Array<{ match: RegExp; perShot: number }> = [
  { match: /forte/i, perShot: 0.08 },
  { match: /aria/i, perShot: 0.03 },
];
const IONQ_DEFAULT_PRICE = 0.05;

interface IonqBackend {
  backend?: string;
  qubits?: number;
  status?: string;
  degraded?: boolean;
  characterization_url?: string;
}

/** Stored credential is either a raw key or a JSON object { token } / { key }. */
function parseToken(apiKey: string): string | null {
  const raw = (apiKey ?? "").trim();
  if (!raw) return null;
  try {
    const c = JSON.parse(raw);
    if (c && typeof c === "object") {
      const t = c.token ?? c.key ?? c.apiKey;
      if (t) return String(t).trim();
    }
  } catch {
    /* not JSON → treat the whole value as the key */
  }
  return raw;
}

function authHeaders(token: string): Record<string, string> {
  return { Accept: "application/json", Authorization: `apiKey ${token}` };
}

function priceFor(backend: string): number {
  return IONQ_PRICE_BY_FAMILY.find((p) => p.match.test(backend))?.perShot ?? IONQ_DEFAULT_PRICE;
}

/** "qpu.forte-enterprise-1" → "Forte Enterprise 1". */
function displayName(backend: string): string {
  return backend
    .replace(/^qpu\./i, "")
    .split(/[-_.]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** A backend counts as usable unless it's explicitly unavailable/offline. */
function isUsable(status?: string): boolean {
  const s = (status ?? "").toLowerCase();
  if (s.includes("unavailable") || s.includes("offline") || s.includes("retired")) return false;
  return true; // available / running / reserved / calibrating / unknown → include
}

async function listBackends(token: string): Promise<IonqBackend[]> {
  const res = await fetch(`${IONQ_API}/backends`, { headers: authHeaders(token) });
  if (res.status === 401 || res.status === 403) {
    throw new Error("IonQ auth failed — check the API key (header uses “apiKey <key>”).");
  }
  if (!res.ok) throw new Error(`IonQ backends request failed (${res.status}).`);
  const j = (await res.json()) as unknown;
  const list = Array.isArray(j)
    ? j
    : ((j as Record<string, unknown>)?.backends ??
        (j as Record<string, unknown>)?.data ??
        []);
  const arr = Array.isArray(list) ? (list as IonqBackend[]) : [];
  // Only physical QPUs feed the index (exclude simulators).
  return arr.filter((b) => (b.backend ?? "").toLowerCase().startsWith("qpu."));
}

interface IonqCharacterization {
  date?: number;
  qubits?: number;
  fidelity?: { "2q"?: { median?: number; mean?: number } };
}

/** Resolve a (possibly relative) characterization_url to an absolute URL. */
function resolveCharUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const host = (process.env.IONQ_API_BASE || "https://api.ionq.co").replace(/\/+$/, "");
  return host + (url.startsWith("/") ? url : `/${url}`);
}

/**
 * Fetch a backend's CURRENT characterization. The plain
 * `/characterizations/backends/{backend}` path returns an ARRAY of all
 * characterizations, so we prefer the per-backend `characterization_url`
 * pointer, then `.../current`, and finally fall back to the array (taking the
 * most recent by `date`). Returns null if none resolve.
 */
async function fetchCharacterization(
  token: string,
  backend: string,
  charUrl?: string,
): Promise<IonqCharacterization | null> {
  const base = `${IONQ_API}/characterizations/backends/${encodeURIComponent(backend)}`;
  const urls = [
    ...(charUrl ? [resolveCharUrl(charUrl)] : []),
    `${base}/current`,
    base, // array fallback
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: authHeaders(token) });
      if (!res.ok) continue;
      const j = (await res.json()) as unknown;
      const arr = Array.isArray(j)
        ? j
        : Array.isArray((j as Record<string, unknown>)?.data)
          ? ((j as Record<string, unknown>).data as unknown[])
          : null;
      if (arr) {
        const latest = (arr as IonqCharacterization[]).reduce<IonqCharacterization | null>(
          (best, cur) => (!best || (cur?.date ?? 0) > (best?.date ?? 0) ? cur : best),
          null,
        );
        if (latest) return latest;
      } else if (j && typeof j === "object") {
        return j as IonqCharacterization;
      }
    } catch {
      /* try the next candidate URL */
    }
  }
  return null;
}

/** Median two-qubit gate fidelity (fallback to mean) + qubit count, best-effort. */
async function characterize(
  token: string,
  backend: string,
  charUrl?: string,
): Promise<{ fid2q: number | null; qubits: number | null }> {
  const j = await fetchCharacterization(token, backend, charUrl);
  if (!j) return { fid2q: null, qubits: null };
  // v0.3 guarantees `mean`; v0.4 guarantees `median` — accept either.
  const twoQ = j.fidelity?.["2q"];
  const raw = twoQ?.median ?? twoQ?.mean;
  const fid2q =
    typeof raw === "number" && raw > 0
      ? Math.max(0, Math.min(0.9999, raw > 1 ? raw / 100 : raw))
      : null;
  const qubits = typeof j.qubits === "number" && j.qubits > 0 ? j.qubits : null;
  return { fid2q, qubits };
}

/** Enrich one listed QPU into a metric (fail-open on the characterization call). */
async function backendToMetrics(token: string, b: IonqBackend): Promise<RawQpuMetrics | null> {
  const name = b.backend;
  if (!name || !isUsable(b.status)) return null;
  const char = await characterize(token, name, b.characterization_url);
  const capacity = char.qubits ?? (typeof b.qubits === "number" && b.qubits > 0 ? b.qubits : IONQ_DEFAULT_QUBITS);
  return {
    provider: "IonQ",
    qpu: displayName(name),
    rawPrice: priceFor(name),
    unit: "per_shot",
    qv: Math.pow(2, Math.min(capacity, 20)),
    clops: IONQ_DEFAULT_CLOPS,
    fid2q: char.fid2q ?? IONQ_DEFAULT_FID2Q,
    capacity,
  };
}

export const ionq: ProviderAdapter = {
  id: "ionq",
  name: "IonQ",
  description: "Aria / Forte trapped-ion QPUs via the IonQ Quantum Cloud direct API.",
  docsUrl: "https://cloud.ionq.com/settings/keys",
  keyPlaceholder: "IonQ API key",
  covers: ["IonQ"],
  testable: true,
  fields: [{ key: "token", label: "IonQ API key", type: "password" }],

  async fetchMetrics(apiKey: string): Promise<RawQpuMetrics[]> {
    const token = parseToken(apiKey);
    if (!token) return [];
    const backends = await listBackends(token);
    const metrics = await Promise.all(backends.map((b) => backendToMetrics(token, b)));
    return metrics.filter((m): m is RawQpuMetrics => m !== null);
  },

  async testConnection(apiKey: string): Promise<ProviderTestResult> {
    const token = parseToken(apiKey);
    if (!token) return { ok: false, message: "Enter your IonQ API key." };
    try {
      const backends = await listBackends(token);
      const usable = backends.filter((b) => isUsable(b.status));
      const details = backends
        .slice(0, 12)
        .map((b) => `${displayName(b.backend ?? "?")} — ${b.status ?? "?"} — ${b.qubits ?? "?"} qubits`);
      return {
        ok: true,
        message: `Connected to IonQ Quantum Cloud. Found ${backends.length} QPU(s), ${usable.length} available.`,
        details,
      };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "Connection failed." };
    }
  },
};
