// Writing a finished run to the user's Downloads folder.
//
// A terminal histogram scrolls away; the file is the artifact people keep. It
// carries everything needed to reproduce and audit the run — the circuit that
// was sent, the route that was chosen, the quote that was charged, the raw
// counts, and the attempt/event trace — not just the counts.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

/** Characters no mainstream filesystem accepts, plus control codes. */
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001F]/g;

export function sanitizeSegment(value, fallback = "unknown") {
  const cleaned = String(value ?? "")
    .replace(ILLEGAL, " ")
    // Collapse dot runs so a hostile or sloppy provider name can never leave
    // `..` in a path segment, and trailing dots (illegal on Windows) go too.
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "")
    .trim()
    .slice(0, 48)
    .trim();
  return cleaned || fallback;
}

/** `2026-08-06 22-58-01` — sortable, and legal on Windows (no colons). */
export function timestampSegment(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`,
  ].join(" ");
}

/**
 * The label the user asked for: `qrouter quantum results ___<provider>___ <when>`.
 * The extension is applied by the caller so the JSON and the summary share a stem.
 *
 * @param {{ provider?: string|null, at?: Date }} [options]
 * @returns {string}
 */
export function resultStem({ provider, at = new Date() } = {}) {
  return `qrouter quantum results ___${sanitizeSegment(provider, "unknown provider").toLowerCase()}___ ${timestampSegment(at)}`;
}

function xdgDownloadDir() {
  try {
    const configFile = path.join(
      process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), ".config"),
      "user-dirs.dirs",
    );
    const match = /^\s*XDG_DOWNLOAD_DIR\s*=\s*"(.*)"\s*$/m.exec(readFileSync(configFile, "utf8"));
    if (!match) return null;
    return match[1].replace(/^\$HOME/, os.homedir());
  } catch {
    return null;
  }
}

/**
 * Resolves the download target.
 * Order: explicit --out → QROUTER_DOWNLOAD_DIR → XDG (Linux) → ~/Downloads →
 * the current directory as a last resort, so a run never fails to save.
 */
export function downloadsDir({ override } = {}) {
  const candidates = [];
  if (override) candidates.push(path.resolve(override));
  if (process.env.QROUTER_DOWNLOAD_DIR?.trim()) candidates.push(path.resolve(process.env.QROUTER_DOWNLOAD_DIR.trim()));
  if (process.platform === "linux") {
    const xdg = xdgDownloadDir();
    if (xdg) candidates.push(xdg);
  }
  candidates.push(path.join(os.homedir(), "Downloads"));
  candidates.push(process.cwd());

  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate)) mkdirSync(candidate, { recursive: true });
      return candidate;
    } catch {
      /* try the next candidate */
    }
  }
  return process.cwd();
}

/** Never overwrite an earlier run: `… (2).json`, `… (3).json`, … */
export function uniquePath(dir, stem, extension) {
  let attempt = path.join(dir, `${stem}${extension}`);
  let counter = 2;
  while (existsSync(attempt)) {
    attempt = path.join(dir, `${stem} (${counter})${extension}`);
    counter += 1;
    if (counter > 999) break;
  }
  return attempt;
}

function topOutcomes(counts, shots, limit = 12) {
  const entries = Object.entries(counts || {}).sort((a, b) => Number(b[1]) - Number(a[1]));
  const total = shots || entries.reduce((sum, [, value]) => sum + Number(value), 0) || 1;
  return entries.slice(0, limit).map(([bits, value]) => {
    const share = Number(value) / total;
    const bar = "#".repeat(Math.max(1, Math.round(share * 40)));
    return `  |${bits}>  ${bar.padEnd(40, ".")}  ${String(value).padStart(7)}  ${(share * 100).toFixed(2)}%`;
  });
}

/**
 * Builds the JSON document. Kept pure so it can be asserted in tests.
 */
export function buildResultDocument({ job, result, circuit, session, baseUrl, cliVersion, savedAt = new Date() }) {
  const decision = job?.route_decision ?? null;
  const selected = decision?.selected ?? null;
  const analysis = job?.analysis ?? null;
  const quote = job?.quote ?? null;

  return {
    schema: "qrouter.cli.result/1",
    saved_at: savedAt.toISOString(),
    source: { client: "qrouter-cli", version: cliVersion, base_url: baseUrl },
    organization: session?.organization ?? null,
    job: {
      id: job?.id ?? null,
      name: job?.name ?? null,
      status: job?.status ?? null,
      shots: job?.shots ?? null,
      target: job?.target ?? null,
      routing_mode: job?.routing_mode ?? null,
      input_format: job?.input_format ?? null,
      created_at: job?.created_at ?? null,
      started_at: job?.started_at ?? null,
      completed_at: job?.completed_at ?? null,
      error: job?.error ?? null,
    },
    routing: {
      provider: selected?.provider ?? null,
      backend_id: job?.selected_backend_id ?? selected?.id ?? null,
      backend_name: selected?.displayName ?? null,
      kind: selected?.kind ?? null,
      region: selected?.region ?? null,
      queue_seconds: selected?.queueSeconds ?? null,
      explanation: decision?.explanation ?? null,
      candidates: (decision?.candidates ?? []).map((candidate) => ({
        backend_id: candidate?.backend?.id ?? null,
        provider: candidate?.backend?.provider ?? null,
        score: candidate?.score ?? null,
        estimated_cost: candidate?.estimatedCost ?? candidate?.cost ?? null,
      })),
    },
    quote,
    analysis,
    circuit,
    result: result ?? job?.result ?? null,
    attempts: job?.attempts ?? null,
    events: job?.events ?? null,
  };
}

/** The human-readable companion, for people who open the folder, not the JSON. */
export function buildResultSummary(document) {
  const { job, routing, result, quote } = document;
  const counts = result?.counts ?? {};
  const lines = [
    "QRouter quantum results",
    "=======================",
    "",
    `Provider        ${routing.provider ?? "unknown"}`,
    `Backend         ${routing.backend_name ?? routing.backend_id ?? "unknown"}${routing.kind ? ` (${routing.kind})` : ""}`,
    `Status          ${job.status ?? "unknown"}`,
    `Shots           ${job.shots ?? "unknown"}`,
    `Routing mode    ${job.routing_mode ?? "unknown"} (requested target: ${job.target ?? "auto"})`,
    `Job id          ${job.id ?? "unknown"}`,
    `Submitted       ${job.created_at ?? "unknown"}`,
    `Completed       ${job.completed_at ?? "unknown"}`,
    `Charged         ${quote?.total === undefined || quote?.total === null ? "unknown" : `$${Number(quote.total).toFixed(4)}`}`,
    `Organization    ${document.organization?.name ?? "unknown"}`,
    `Saved by        qrouter-cli ${document.source.version} via ${document.source.base_url}`,
    "",
  ];

  // The router returns its reasoning as a list of clauses; keep them as lines
  // rather than letting Array#toString glue them together with commas.
  const reasons = Array.isArray(routing.explanation)
    ? routing.explanation
    : String(routing.explanation ?? "").split("\n");
  const cleaned = reasons.map((entry) => String(entry).trim()).filter(Boolean);
  if (cleaned.length) {
    lines.push("Why this backend", "----------------", ...cleaned.map((entry) => `  ${entry}`), "");
  }

  if (Object.keys(counts).length) {
    lines.push("Measurement outcomes", "--------------------", ...topOutcomes(counts, job.shots), "");
    const distinct = Object.keys(counts).length;
    if (distinct > 12) lines.push(`  (${distinct - 12} further outcomes are in the JSON file)`, "");
  } else if (job.error) {
    lines.push("Error", "-----", `  ${job.error?.message ?? JSON.stringify(job.error)}`, "");
  }

  if (document.circuit?.source) {
    lines.push(`Circuit (${document.circuit.format ?? "openqasm2"})`, "-".repeat(20), document.circuit.source.trimEnd(), "");
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Writes `<stem>.json` and `<stem>.txt` into the downloads folder.
 * @returns {{ dir: string, jsonPath: string, summaryPath: string|null }}
 */
export function saveResult({ document, dir, includeSummary = true, at = new Date() }) {
  const target = dir ?? downloadsDir();
  const stem = resultStem({ provider: document.routing?.provider ?? document.routing?.backend_id, at });
  const jsonPath = uniquePath(target, stem, ".json");
  writeFileSync(jsonPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");

  let summaryPath = null;
  if (includeSummary) {
    // Share the stem the JSON actually got, so the pair stays together even
    // when a collision bumped the name.
    const resolvedStem = path.basename(jsonPath, ".json");
    summaryPath = path.join(target, `${resolvedStem}.txt`);
    writeFileSync(summaryPath, buildResultSummary(document), "utf8");
  }
  return { dir: target, jsonPath, summaryPath };
}
