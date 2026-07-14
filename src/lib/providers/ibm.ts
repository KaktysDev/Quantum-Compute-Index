// ──────────────────────────────────────────────────────────────────────────────
// IBM Quantum — REAL integration (IBM Quantum Platform on IBM Cloud).
//
// Credentials are an encrypted JSON object: { apiKey, crn }.
//   apiKey = IBM Cloud IAM API key
//   crn    = the instance "Service-CRN" (from the IBM Quantum Platform instances page)
//
// Flow:
//   1. Exchange the API key for a short-lived IAM bearer token.
//   2. GET /api/v1/backends  → one call returns every device's qubit count, live
//      status, queue length, and two-qubit error (→ fidelity).
//
// IBM does not return pricing via the API, so we use the published Pay-As-You-Go
// list rate ($96/min). CLOPS isn't exposed either → a sensible default.
// Docs: https://quantum.cloud.ibm.com/docs/en/api/qiskit-runtime-rest/tags/backends
// ──────────────────────────────────────────────────────────────────────────────

import type { RawQpuMetrics } from "@/lib/qci/types";
import type { ProviderAdapter, ProviderTestResult } from "./types";

interface IbmCreds {
  apiKey: string;
  crn: string;
}

const IAM_URL = "https://iam.cloud.ibm.com/identity/token";
const BACKENDS_URL = "https://quantum.cloud.ibm.com/api/v1/backends";
const API_VERSION = "2025-05-01";
const IBM_PRICE_PER_MIN = 96; // IBM Pay-As-You-Go published list rate
const DEFAULT_CLOPS = 2500;

interface IbmBackend {
  name?: string;
  backend_name?: string;
  id?: string;
  qubits?: number;
  n_qubits?: number;
  status?: string;
  operational?: boolean;
  queue_length?: number;
  performance_metrics?: {
    two_q_error_median?: number;
    two_q_error_best?: number;
  };
  wait_time_seconds?: { avg?: number; p50?: number };
}

function parseCreds(apiKey: string): IbmCreds | null {
  try {
    const c = JSON.parse(apiKey);
    if (c && c.apiKey && c.crn) {
      return { apiKey: String(c.apiKey).trim(), crn: String(c.crn).trim() };
    }
  } catch {
    /* not JSON — invalid for IBM */
  }
  return null;
}

/**
 * Explain WHY a stored credential can't be used. The common case is a raw
 * (non-JSON) string: a key saved by the old single-input form, which never
 * stored the CRN at all.
 */
function credsProblem(raw: string): string {
  try {
    const c = JSON.parse(raw) as Partial<IbmCreds>;
    const missing = [
      !c?.apiKey && "the IBM Cloud API key",
      !c?.crn && "the Instance CRN",
    ].filter(Boolean);
    return `The stored IBM credential is missing ${missing.join(" and ")}. Paste both fields above and save again.`;
  } catch {
    return "The stored IBM credential contains only the API key — it was saved by an older version of this form that had no CRN field. Paste BOTH the IBM Cloud API key and the Instance CRN above, then Save to replace it.";
  }
}

/** Exchange an IBM Cloud API key for a short-lived IAM bearer token. */
async function getIamToken(apiKey: string): Promise<string> {
  const res = await fetch(IAM_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "urn:ibm:params:oauth:grant-type:apikey",
      apikey: apiKey,
    }),
  });
  if (!res.ok) {
    // Surface IAM's own reason (e.g. BXNIM0415E "Provided API key could not be
    // found") instead of a generic hint — it pinpoints the actual problem.
    let detail = "";
    try {
      const e = (await res.json()) as { errorMessage?: string; errorCode?: string };
      detail = [e.errorCode, e.errorMessage].filter(Boolean).join(" ");
    } catch {
      /* non-JSON error body */
    }
    // Legacy quantum.ibm.com tokens are long hex strings; IAM only accepts
    // IBM Cloud API keys — a very common mixup since the platform migration.
    const legacyHint = /^[0-9a-f]{48,}$/i.test(apiKey)
      ? " This looks like a legacy IBM Quantum token — create an IBM Cloud API key instead (cloud.ibm.com → Manage → Access (IAM) → API keys)."
      : "";
    throw new Error(
      `IBM IAM auth failed (${res.status})${detail ? `: ${detail}` : " — check the API key."}${legacyHint}`,
    );
  }
  const j = (await res.json()) as { access_token?: string };
  if (!j.access_token) throw new Error("IBM IAM returned no access token.");
  return j.access_token;
}

async function fetchBackends(token: string, crn: string): Promise<IbmBackend[]> {
  const res = await fetch(BACKENDS_URL, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Service-CRN": crn,
      "IBM-API-Version": API_VERSION,
    },
  });
  if (!res.ok) {
    let detail = "";
    try {
      const e = (await res.json()) as { errors?: Array<{ message?: string }>; message?: string };
      detail = e.message ?? e.errors?.map((x) => x.message).filter(Boolean).join("; ") ?? "";
    } catch {
      /* non-JSON error body */
    }
    throw new Error(
      `IBM backends request failed (${res.status})${detail ? `: ${detail}` : ""} — check the Instance CRN (copy the full CRN from your instance on quantum.cloud.ibm.com; it starts with "crn:v1:bluemix:" and ends with "::").`,
    );
  }
  const j = (await res.json()) as Record<string, unknown>;
  const list = (j.devices ?? j.backends ?? (Array.isArray(j) ? j : [])) as IbmBackend[];
  return Array.isArray(list) ? list : [];
}

function backendName(b: IbmBackend): string {
  return b.name ?? b.backend_name ?? b.id ?? "IBM QPU";
}

function isOnline(b: IbmBackend): boolean {
  if (b.operational === false) return false;
  const s = (b.status ?? "").toString().toLowerCase();
  if (s.includes("offline") || s.includes("paused") || s.includes("retired")) return false;
  return true; // online / active / unknown → include
}

/** Pure mapping from an IBM backend record → our metric shape. */
export function mapBackendToMetrics(b: IbmBackend): RawQpuMetrics {
  const qubits = Number(b.qubits ?? b.n_qubits ?? 0) || 0;
  const twoQErr =
    b.performance_metrics?.two_q_error_median ?? b.performance_metrics?.two_q_error_best;
  const fid2q =
    typeof twoQErr === "number" ? Math.max(0, Math.min(0.9999, 1 - twoQErr)) : 0.99;
  const wait = b.wait_time_seconds?.avg ?? b.wait_time_seconds?.p50;
  const capacity = qubits || 27;
  return {
    provider: "IBM",
    qpu: backendName(b),
    rawPrice: IBM_PRICE_PER_MIN,
    unit: "per_minute",
    qv: Math.pow(2, Math.min(capacity, 20)),
    clops: DEFAULT_CLOPS,
    fid2q,
    capacity,
    queueSeconds: typeof wait === "number" ? wait : undefined,
  };
}

export const ibm: ProviderAdapter = {
  id: "ibm",
  name: "IBM Quantum",
  description: "Eagle / Heron superconducting QPUs via IBM Quantum Platform.",
  docsUrl: "https://quantum.cloud.ibm.com/",
  keyPlaceholder: "IBM Cloud API key",
  covers: ["IBM Quantum"],
  testable: true,
  fields: [
    { key: "apiKey", label: "IBM Cloud API key", type: "password" },
    {
      key: "crn",
      label: "Instance CRN",
      placeholder: "crn:v1:bluemix:public:quantum-computing:…",
    },
  ],

  async fetchMetrics(apiKey: string): Promise<RawQpuMetrics[]> {
    const creds = parseCreds(apiKey);
    if (!creds) return [];
    const token = await getIamToken(creds.apiKey);
    const backends = await fetchBackends(token, creds.crn);
    return backends.filter(isOnline).map(mapBackendToMetrics);
  },

  async testConnection(apiKey: string): Promise<ProviderTestResult> {
    const creds = parseCreds(apiKey);
    if (!creds) {
      return { ok: false, message: credsProblem(apiKey) };
    }
    try {
      const token = await getIamToken(creds.apiKey);
      const backends = await fetchBackends(token, creds.crn);
      const online = backends.filter(isOnline);
      const details = backends
        .slice(0, 12)
        .map((b) => {
          const q = Number(b.qubits ?? b.n_qubits ?? 0) || 0;
          const s = (b.status ?? "?").toString();
          return `${backendName(b)} — ${s} — ${q} qubits`;
        });
      return {
        ok: true,
        message: `Connected to IBM Quantum. Found ${backends.length} backend(s), ${online.length} online.`,
        details,
      };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "Connection failed." };
    }
  },
};
