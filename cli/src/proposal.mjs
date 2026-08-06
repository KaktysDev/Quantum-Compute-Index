// The job proposal: parse it, price it, show it, confirm it, run it, save it.
//
// This mirrors the console's JobProposalCard exactly, and for the same reason:
// the assistant may be wrong, so nothing it says about cost or backend is
// displayed. The card shows QRouter's own quote from /api/chat/quote, and the
// run only happens after the user types `run`.

import { randomUUID } from "node:crypto";
import { ApiError } from "./api.mjs";
import { buildResultDocument, saveResult } from "./results.mjs";
import {
  accent,
  box,
  count,
  duration,
  failure,
  glyph,
  histogram,
  line,
  money,
  spinner,
  style,
  success,
  warn,
} from "./ui.mjs";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "awaiting_payment"]);
const ROUTING_MODES = new Set(["balanced", "cost", "speed", "quality"]);
const FORMATS = new Set(["openqasm2", "openqasm3"]);

/**
 * @typedef {object} NormalizedProposal
 * @property {string} name
 * @property {string} note
 * @property {string|null} circuit
 * @property {{ url: string, path: string, ref?: string }|null} repository
 * @property {"openqasm2"|"openqasm3"} format
 * @property {number} shots
 * @property {string} target
 * @property {"balanced"|"cost"|"speed"|"quality"} routing_mode
 * @property {Record<string, unknown>} constraints
 */

/**
 * Validates and normalizes a ```qrouter-proposal``` payload.
 * Anything the model got wrong is rejected here rather than sent to the API.
 *
 * @param {string} raw
 * @returns {{ ok: true, proposal: NormalizedProposal } | { ok: false, error: string }}
 */
export function parseProposal(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: `The assistant's job proposal was not valid JSON (${error.message}).` };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "The assistant's job proposal was not an object." };
  }

  const hasCircuit = typeof parsed.circuit === "string" && parsed.circuit.trim().length > 0;
  const repository = parsed.repository && typeof parsed.repository === "object" ? parsed.repository : null;
  const hasRepository = Boolean(repository?.url && repository?.path);
  if (!hasCircuit && !hasRepository) {
    return { ok: false, error: "The proposal carries neither inline OpenQASM nor a repository circuit." };
  }

  const shots = Number.isFinite(Number(parsed.shots)) ? Math.floor(Number(parsed.shots)) : 1024;
  if (shots < 1 || shots > 1_000_000) {
    return { ok: false, error: `The proposal asked for ${parsed.shots} shots, which is outside the accepted range (1–1,000,000).` };
  }

  const constraints = parsed.constraints && typeof parsed.constraints === "object" && !Array.isArray(parsed.constraints)
    ? parsed.constraints
    : {};

  return {
    ok: true,
    proposal: {
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim().slice(0, 120) : "Assistant task",
      note: typeof parsed.note === "string" ? parsed.note.trim() : "",
      circuit: hasCircuit ? parsed.circuit : null,
      // `circuit` wins when a model sends both, matching the console.
      repository: hasCircuit ? null : { url: repository.url, path: repository.path, ref: repository.ref || undefined },
      format: FORMATS.has(parsed.format) ? parsed.format : "openqasm2",
      shots,
      target: typeof parsed.target === "string" && parsed.target.trim() ? parsed.target.trim() : "auto",
      routing_mode: ROUTING_MODES.has(parsed.routing_mode) ? parsed.routing_mode : "balanced",
      constraints,
    },
  };
}

/**
 * Resolves the circuit (fetching it from GitHub when the proposal points at a
 * repository) and asks the routing engine for a real quote.
 */
export async function prepareProposal({ client, proposal }) {
  let circuit = proposal.circuit;
  let format = proposal.format;
  let sourcePath = null;

  if (!circuit && proposal.repository) {
    const loading = spinner(`reading ${proposal.repository.path} from ${shortRepo(proposal.repository.url)}…`).start();
    try {
      const source = await client.repositoryCircuit({
        repository: proposal.repository.url,
        path: proposal.repository.path,
        ref: proposal.repository.ref,
      });
      circuit = source.circuit;
      format = source.format ?? format;
      sourcePath = source.path ?? proposal.repository.path;
    } finally {
      loading.stop();
    }
  }
  if (!circuit) throw new Error("The proposal did not resolve to any circuit source.");

  const quoting = spinner("routing and quoting…").start();
  try {
    const quote = await client.quote({
      circuit,
      format,
      shots: proposal.shots,
      target: proposal.target,
      routing_mode: proposal.routing_mode,
      constraints: proposal.constraints,
    });
    return { circuit, format, sourcePath, quote };
  } finally {
    quoting.stop();
  }
}

export function shortRepo(url) {
  return String(url).replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\.git$/, "");
}

/** `RouteDecision.explanation` is a string[]; older shapes may send a string. */
export function explanationLines(explanation) {
  if (!explanation) return [];
  const parts = Array.isArray(explanation) ? explanation : String(explanation).split("\n");
  return parts.map((part) => String(part).trim()).filter(Boolean);
}

/** The confirmation card. Every number here came from the server. */
export function renderProposalCard({ proposal, prepared, balance }) {
  const selected = prepared.quote?.decision?.selected ?? {};
  const analysis = prepared.quote?.analysis ?? {};
  const total = prepared.quote?.quote?.total;
  const insufficient = typeof total === "number" && typeof balance === "number" && total > balance;

  box("Job proposal — requires your confirmation", (row) => {
    if (proposal.note) {
      row(style.gray(proposal.note));
      row();
    }
    const circuitLabel = proposal.repository
      ? `${prepared.sourcePath ?? proposal.repository.path} ${glyph.dot} ${shortRepo(proposal.repository.url)}`
      : `inline ${proposal.format}`;
    const shape = analysis.qubits
      ? `${analysis.qubits} qubits ${glyph.dot} depth ${analysis.depth} ${glyph.dot} ${count(analysis.gates ?? 0)} gates`
      : null;

    const entries = [
      ["Circuit", circuitLabel],
      shape ? ["Shape", shape] : null,
      ["Shots", count(proposal.shots)],
      ["Routing", `${proposal.routing_mode} ${glyph.dot} target ${proposal.target}`],
      ["Backend", `${style.bold(selected.displayName ?? selected.id ?? "unknown")}${selected.provider ? style.gray(` (${selected.provider})`) : ""}`],
      typeof selected.queueSeconds === "number" ? ["Queue", `~${duration(selected.queueSeconds * 1000)}`] : null,
      ["QRouter quote", accent(money(total))],
      ["Credits", balance === null || balance === undefined ? "unknown" : `${money(balance, 2)} available`],
    ].filter(Boolean);

    const labelWidth = Math.max(...entries.map(([label]) => label.length));
    for (const [label, value] of entries) {
      row(`${style.gray(label.padEnd(labelWidth))}  ${value}`);
    }

    const reasons = explanationLines(prepared.quote?.decision?.explanation);
    if (reasons.length) {
      row();
      // The router explains itself in short clauses; show the first two so the
      // card stays scannable and the rest lands in the saved file.
      for (const reason of reasons.slice(0, 2)) row(style.gray(reason));
    }
    if (insufficient) {
      row();
      row(style.yellow(`${glyph.warn} The quote exceeds your available credits. Add credits at https://qrouter.app/dashboard/billing`));
    }
  });

  return { insufficient, total };
}

/**
 * Submits the job and drives it to a terminal state.
 *
 * Deployments without a fleet scheduler need somebody to advance the job, so
 * the wait loop calls POST /api/v1/jobs/{id}/advance each tick. If that
 * endpoint is unavailable (older deployment, read-only key) it degrades to
 * plain polling and says so once, rather than hanging silently.
 */
export async function runJob({ client, proposal, prepared, onStatus, timeoutMs = 15 * 60_000 }) {
  const idempotencyKey = randomUUID();
  let job;
  try {
    job = await client.createJob(
      {
        name: proposal.name,
        circuit: prepared.circuit,
        format: prepared.format,
        shots: proposal.shots,
        target: proposal.target,
        routing_mode: proposal.routing_mode,
        constraints: proposal.constraints,
      },
      idempotencyKey,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 402) {
      const quoted = error.body?.error?.quote?.total;
      throw new ApiError(
        `Not enough credits to run this job${quoted ? ` (it quotes at ${money(quoted)})` : ""}. The job is parked and will start automatically once you add credits at https://qrouter.app/dashboard/billing`,
        { status: 402, type: "insufficient_credits", body: error.body },
      );
    }
    throw error;
  }

  const jobId = job?.id;
  if (!jobId) throw new Error("The API accepted the job but returned no job id.");

  const settled = await waitForJob({ client, jobId, initial: job, onStatus, timeoutMs });
  return {
    jobId,
    job: settled.job,
    timedOut: settled.timedOut,
    advanceAvailable: settled.advanceAvailable,
    blocked: settled.blocked,
  };
}

/** Statuses where the provider owns the job, so polling it hard buys nothing. */
const PROVIDER_OWNED = new Set(["submitted", "processing", "cancellation_requested"]);

/**
 * Chooses how long to wait before the next check.
 *
 * A queued job changes state as soon as somebody claims it, so those checks are
 * quick. Once the provider has it, each check is a real upstream status call and
 * a QPU job can sit in a queue for hours — so that phase backs off toward ten
 * seconds instead of hammering the provider (and the org's rate limit) at ~1 Hz.
 */
function nextInterval({ status, action, previous, base }) {
  if (PROVIDER_OWNED.has(status)) return Math.min(Math.max(previous * 1.5, 2_000), 10_000);
  if (action === "waiting") return Math.min(previous * 1.4, 5_000);
  return base;
}

export async function waitForJob({ client, jobId, initial = null, onStatus, timeoutMs = 15 * 60_000, pollMs = 900 }) {
  const startedAt = Date.now();
  let job = initial;
  let advanceAvailable = true;
  let interval = pollMs;
  let status = job?.status ?? "queued";
  let blocked = null;

  if (TERMINAL_STATUSES.has(status)) {
    // Demo mode and inline-completing simulators settle inside the create call.
    return { job: await refresh(client, jobId, job), timedOut: false, advanceAvailable, blocked };
  }

  for (;;) {
    if (Date.now() - startedAt > timeoutMs) {
      return { job: await refresh(client, jobId, job), timedOut: true, advanceAvailable, blocked };
    }

    let action = null;
    if (advanceAvailable) {
      try {
        const outcome = await client.advanceJob(jobId);
        action = outcome?.action ?? null;
        if (outcome?.status) status = outcome.status;
        if (action === "not_claimable") {
          // The job carries no quote or no credit reservation. Waiting cannot
          // fix that, so stop instead of spinning until the timeout.
          blocked = outcome?.detail ?? "The job cannot be started.";
          return { job: await refresh(client, jobId, job), timedOut: false, advanceAvailable, blocked };
        }
      } catch (error) {
        if (error instanceof ApiError && [403, 404, 405, 501].includes(error.status)) {
          // Older deployment, or a key without jobs:write. Fall back to polling
          // and let whatever scheduler exists do the driving.
          advanceAvailable = false;
        } else if (error instanceof ApiError && error.status < 500 && error.status !== 0) {
          throw error;
        }
        // 5xx / network: transient. Read the status and try again next tick.
      }
    }

    if (!advanceAvailable) {
      job = await client.getJob(jobId);
      status = job?.status ?? status;
    }

    interval = nextInterval({ status, action, previous: interval, base: pollMs });
    onStatus?.({ status, elapsedMs: Date.now() - startedAt, advanceAvailable });

    if (TERMINAL_STATUSES.has(status)) {
      return { job: await refresh(client, jobId, job), timedOut: false, advanceAvailable, blocked };
    }
    await sleep(interval);
  }
}

async function refresh(client, jobId, fallback) {
  try {
    return await client.getJob(jobId);
  } catch {
    return fallback;
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Fetches the stored result artifact, falling back to the inline job result. */
export async function loadResult(client, job) {
  if (!job?.id) return job?.result ?? null;
  try {
    const artifact = await client.jobResult(job.id);
    if (artifact && typeof artifact === "object") return artifact;
  } catch {
    /* artifact storage is optional; the job row carries the result too */
  }
  return job?.result ?? null;
}

/** Terminal summary + the saved files. */
export function reportOutcome({ job, result, circuit, session, baseUrl, cliVersion, outDir, includeSummary = true }) {
  const status = job?.status ?? "unknown";
  const selected = job?.route_decision?.selected ?? {};
  const backend = selected.displayName ?? job?.selected_backend_id ?? "unknown backend";
  const provider = selected.provider ?? "unknown";

  if (status === "completed") {
    success(`${style.bold("Completed")} on ${style.bold(backend)} ${style.gray(`(${provider})`)}`);
  } else if (status === "awaiting_payment") {
    warn(`${style.bold("Parked — awaiting payment.")} It starts automatically once credits arrive.`);
  } else {
    failure(`${style.bold(`Job ${status}`)}${job?.error?.message ? ` ${glyph.dot} ${job.error.message}` : ""}`);
  }

  const counts = result?.counts ?? job?.result?.counts ?? null;
  if (counts && Object.keys(counts).length) {
    line();
    histogram(counts, job?.shots ?? result?.shots);
  }

  const charged = job?.quote?.total;
  line();
  line(
    `  ${style.gray("job")} ${job?.id ?? "unknown"}   ${style.gray("charged")} ${money(charged)}   ${style.gray("shots")} ${count(job?.shots ?? 0)}`,
  );

  // Failed and cancelled runs are saved too — a failure trace is the thing you
  // most want to keep, and it carries the attempt history.
  const document = buildResultDocument({ job, result, circuit, session, baseUrl, cliVersion });
  let saved = null;
  try {
    saved = saveResult({ document, dir: outDir, includeSummary });
    line(`  ${style.gray("saved")} ${accent(saved.jsonPath)}`);
    if (saved.summaryPath) line(`  ${style.gray("      ")} ${style.gray(saved.summaryPath)}`);
  } catch (error) {
    warn(`Could not write the result file: ${error.message}`);
  }
  return { saved, document };
}
