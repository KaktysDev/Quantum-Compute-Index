// Command surface.
//
// `qrouter` with no arguments is the product: paste a key, talk to the
// assistant, confirm a job, get results in Downloads. The subcommands exist for
// the cases a conversation is the wrong shape — scripts, CI, and checking on a
// job that outlived the session that started it.

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { ApiError } from "./api.mjs";
import { authenticate, banner, describeSession } from "./auth.mjs";
import { CONFIRMATIONS, startChat } from "./chat.mjs";
import { clearStoredKey, configPath, maskKey, resolveBaseUrl, DEFAULT_BASE_URL } from "./config.mjs";
import { createPrompter } from "./prompt.mjs";
import { loadResult, parseProposal, prepareProposal, renderProposalCard, reportOutcome, runJob, waitForJob } from "./proposal.mjs";
import { downloadsDir } from "./results.mjs";
import {
  accent,
  blank,
  configure as configureUi,
  data,
  duration,
  failure,
  glyph,
  info,
  line,
  money,
  rows,
  spinner,
  style,
  success,
  warn,
} from "./ui.mjs";

export const VERSION = "0.1.0";

const BOOLEAN_FLAGS = new Set(["help", "version", "yes", "no-color", "no-summary", "json", "wait", "no-save", "quote", "run"]);

/** Tiny long-flag parser: `--flag`, `--flag value`, `--flag=value`, `-h`, `-v`. */
export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      positional.push(...argv.slice(index + 1));
      break;
    }
    if (token.startsWith("--")) {
      const body = token.slice(2);
      const equals = body.indexOf("=");
      if (equals !== -1) {
        flags[body.slice(0, equals)] = body.slice(equals + 1);
        continue;
      }
      if (BOOLEAN_FLAGS.has(body)) {
        flags[body] = true;
        continue;
      }
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[body] = true;
        continue;
      }
      flags[body] = next;
      index += 1;
      continue;
    }
    if (token === "-h") {
      flags.help = true;
      continue;
    }
    if (token === "-v") {
      flags.version = true;
      continue;
    }
    positional.push(token);
  }
  return { flags, positional };
}

const USAGE = `
  ${style.bold("qrouter")} — quantum compute from your terminal

  ${style.gray("usage")}
    npx qrouter.app                       start the assistant (default)
    qrouter chat [message]                start it with a first message
    qrouter experiments                  list experiment definitions
    qrouter experiment <id>               inspect definition and result evidence
    qrouter experiment <id> --quote       preview the complete campaign cost
    qrouter experiment <id> --run         approve and submit a campaign
    qrouter run <file.qasm|repo-url>      run a circuit without the assistant
    qrouter status <job-id> [--wait]      check, or finish, an earlier job
    qrouter cancel <job-id>               ask the provider to stop a running job
    qrouter backends                      what this key can run on right now
    qrouter whoami                        key, workspace, credits
    qrouter login | logout                store or forget the API key

  ${style.gray("run options")}
    --shots <n>            shots to execute (default 1024)
    --target <backend|auto> pin a backend (default auto)
    --mode <balanced|cost|speed|quality>  routing preference
    --max-cost <usd>       cap the complete execution reservation
    --intent <simulate|hardware>  explicit execution intent
    --path <file.qasm>     circuit path, when the target is a repository
    --ref <branch>         repository ref (default the repo's default branch)
    --name <text>          label the job
    --yes                  skip the confirmation prompt

  ${style.gray("experiment run options")}
    --max-cost <usd>       required; must equal the immutable campaign ceiling
    --yes                  explicit non-interactive approval (otherwise type run)
    --idempotency-key <key> reuse this key when retrying the same run

  ${style.gray("global options")}
    --key <qci_...>        use this key instead of the stored one
    --base-url <url>       point at another deployment (default ${DEFAULT_BASE_URL})
    --out <dir>            write results here instead of Downloads
    --no-summary           write only the .json, not the .txt companion
    --timeout <seconds>    give up waiting on a run (default 900)
    --json                 machine-readable output where it applies
    --no-color             plain text
    -h, --help             this message
    -v, --version          print the version

  ${style.gray("environment")}
    QROUTER_API_KEY        key to use (never written to disk)
    QROUTER_BASE_URL       default deployment
    QROUTER_DOWNLOAD_DIR   where results are saved
`;

function fail(message, { requestId } = {}) {
  failure(message);
  if (requestId) line(`  ${style.gray(`request ${requestId}`)}`);
  blank();
  return 1;
}

function commonOptions(flags) {
  const timeoutSeconds = Number(flags.timeout);
  return {
    baseUrl: resolveBaseUrl({ flagBaseUrl: typeof flags["base-url"] === "string" ? flags["base-url"] : undefined }),
    flagKey: typeof flags.key === "string" ? flags.key : undefined,
    outDir: typeof flags.out === "string" ? flags.out : undefined,
    includeSummary: flags["no-summary"] !== true,
    timeoutMs: Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? timeoutSeconds * 1_000 : 15 * 60_000,
    version: VERSION,
  };
}

async function askOnce(question) {
  const prompter = createPrompter();
  try {
    return await prompter.ask(question);
  } finally {
    prompter.close();
  }
}

const GITHUB_URL = /^(https?:\/\/(www\.)?github\.com\/)?[\w.-]+\/[\w.-]+$/i;

/** Builds the same proposal shape the assistant emits, from CLI flags. */
async function proposalFromArgs({ client, targetArg, flags }) {
  const shots = flags.shots === undefined ? 1024 : Number(flags.shots);
  if (!Number.isFinite(shots) || shots < 1) throw new Error(`--shots must be a positive number (got "${flags.shots}").`);

  const constraints = {};
  if (flags.intent !== undefined) {
    if (!["simulate", "hardware"].includes(flags.intent)) throw new Error("--intent must be simulate or hardware.");
    constraints.executionIntent = flags.intent;
  }
  if (flags["max-cost"] !== undefined) {
    const maxCost = Number(flags["max-cost"]);
    if (!Number.isFinite(maxCost) || maxCost <= 0) throw new Error(`--max-cost must be a positive number (got "${flags["max-cost"]}").`);
    constraints.maxCost = maxCost;
  }

  const base = {
    name: typeof flags.name === "string" ? flags.name : undefined,
    shots: Math.floor(shots),
    target: typeof flags.target === "string" ? flags.target : "auto",
    routing_mode: typeof flags.mode === "string" ? flags.mode : "balanced",
    constraints,
  };

  const isRepository = GITHUB_URL.test(targetArg) && !targetArg.toLowerCase().endsWith(".qasm");
  if (isRepository) {
    let circuitPath = typeof flags.path === "string" ? flags.path : null;
    const ref = typeof flags.ref === "string" ? flags.ref : undefined;
    if (!circuitPath) {
      const looking = spinner("looking for a circuit in the repository…").start();
      let inspection;
      try {
        inspection = await client.inspectRepository({ repository: targetArg, ref });
      } finally {
        looking.stop();
      }
      const configured = typeof inspection?.config?.circuit === "string" ? inspection.config.circuit : null;
      const files = inspection?.files ?? [];
      circuitPath = (configured && files.find((file) => file.path === configured)?.path) || files[0]?.path || null;
      if (!circuitPath) {
        throw new Error(`No .qasm file found in ${targetArg}. Point at one with --path.`);
      }
      line(`  ${style.gray(`using ${circuitPath}${configured === circuitPath ? " (from qrouter.json)" : ""}`)}`);
    }
    return {
      ...base,
      name: base.name ?? `${targetArg.split("/").slice(-1)[0]} ${glyph.dot} ${circuitPath}`,
      circuit: null,
      repository: { url: targetArg, path: circuitPath, ref },
      format: "openqasm2",
    };
  }

  const file = path.resolve(targetArg);
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch (error) {
    // Node repeats the path inside its own message; say it once.
    const reason = { ENOENT: "no such file", EACCES: "permission denied", EISDIR: "that is a directory" }[error.code];
    throw new Error(`Could not read ${file}: ${reason ?? error.message}`);
  }
  if (!source.trim()) throw new Error(`${file} is empty.`);
  const format = /^\s*OPENQASM\s+3/im.test(source) ? "openqasm3" : "openqasm2";
  return { ...base, name: base.name ?? path.basename(file), circuit: source, repository: null, format };
}

// ── commands ────────────────────────────────────────────────────────────────

async function commandRun(flags, positional) {
  const options = commonOptions(flags);
  const targetArg = positional[0];
  if (!targetArg) return fail("Give me something to run: a .qasm file or a GitHub repository URL.");

  const { client, session, key } = await authenticate({ ...options, allowPrompt: process.stdin.isTTY });
  describeSession(session, { key, baseUrl: options.baseUrl });
  blank();

  let proposal;
  try {
    proposal = await proposalFromArgs({ client, targetArg, flags });
  } catch (error) {
    return fail(error.message);
  }

  // Reuse the assistant's confirmation path so both entry points quote,
  // display and charge identically.
  const parsed = parseProposal(JSON.stringify(proposal));
  if (!parsed.ok) return fail(parsed.error);

  let prepared;
  try {
    prepared = await prepareProposal({ client, proposal: parsed.proposal });
  } catch (error) {
    return fail(error.message, { requestId: error instanceof ApiError ? error.requestId : undefined });
  }

  const balance = session?.credits?.available ?? null;
  const { insufficient } = renderProposalCard({ proposal: parsed.proposal, prepared, balance });
  blank();
  if (insufficient) return fail("The quote exceeds your available credits. Nothing was submitted.");

  if (flags.yes !== true) {
    if (!process.stdin.isTTY) return fail("Refusing to run without confirmation. Pass --yes for non-interactive use.");
    const answer = ((await askOnce(`  ${accent(glyph.caret)} type ${style.bold("run")} to execute, anything else to cancel: `)) ?? "")
      .trim()
      .toLowerCase();
    if (!CONFIRMATIONS.has(answer)) {
      line(`  ${style.gray("Cancelled — nothing was run and nothing was charged.")}`);
      blank();
      return 0;
    }
  }

  blank();
  const progress = spinner("submitting…").start();
  let outcome;
  try {
    outcome = await runJob({
      client,
      proposal: parsed.proposal,
      prepared,
      timeoutMs: options.timeoutMs,
      onStatus: ({ status, elapsedMs }) => progress.update(`${status.replace(/_/g, " ")} ${style.gray(`${glyph.dot} ${duration(elapsedMs)}`)}`),
    });
  } catch (error) {
    progress.stop();
    return fail(error.message, { requestId: error instanceof ApiError ? error.requestId : undefined });
  }
  progress.stop();

  if (outcome.blocked) {
    return fail(`The job was accepted but cannot start: ${outcome.blocked} (job ${outcome.jobId})`);
  }

  if (outcome.timedOut) {
    warn(`Still running. Finish it later with: qrouter status ${outcome.jobId} --wait`);
    blank();
    return 0;
  }

  const result = await loadResult(client, outcome.job);
  const { document } = reportOutcome({
    job: outcome.job,
    result,
    circuit: { format: prepared.format, source: prepared.circuit, path: prepared.sourcePath },
    session,
    baseUrl: client.baseUrl,
    cliVersion: VERSION,
    outDir: options.outDir,
    includeSummary: options.includeSummary,
  });
  blank();
  if (flags.json) data(JSON.stringify(document));
  return outcome.job?.status === "completed" ? 0 : 1;
}

function renderExperimentEvidence(evidence) {
  const experiment = evidence?.experiment;
  const definition = experiment?.definition;
  if (!experiment || !definition) throw new Error("The server returned no experiment definition.");
  rows([
    ["experiment", experiment.id], ["name", definition.name], ["version", experiment.version],
    ["objective", definition.objective], ["intent", definition.execution_intent],
    ["targets", definition.targets?.join(", ")], ["shots", definition.shots],
    ["campaign ceiling", money(definition.max_total_cost, 6)], ["definition hash", experiment.definition_hash],
    ["source hash", experiment.source_hash], ["released", experiment.released_at ?? "no"],
    ["reference", definition.reference?.kind],
    ["reference provenance", definition.reference?.provenance ?? definition.reference?.reason],
    ["success criterion", definition.success_criterion?.metric],
    ["maximum distance", definition.success_criterion?.max_distance],
    ["confidence", definition.success_criterion?.confidence],
  ]);
  if (definition.reference?.kind === "distribution") {
    const entries = Object.entries(definition.reference.probabilities ?? {});
    rows([["reference probabilities", entries.slice(0, 8).map(([state, probability]) => `${state}: ${probability}`).join(", ")]]);
    if (entries.length > 8) info(`${entries.length - 8} further reference outcomes; inspect the full definition with --json.`);
  }
  if (!evidence.runs?.length) info("No campaign runs recorded.");
  for (const run of evidence.runs ?? []) {
    blank();
    rows([["run", run.id], ["status", run.status], ["execution group", run.group_id]]);
    for (const execution of run.executions ?? []) {
      rows([
        ["target", execution.selected_backend_id ?? execution.target], ["execution", execution.status],
        ["assessment", execution.assessment?.status], ["reason", execution.assessment?.reason],
        ["distance", execution.assessment?.distance], ["interval", execution.assessment?.interval?.join(" – ")],
        ["cost evidence", execution.cost_status], ["charged USD", execution.charged_usd],
      ]);
    }
  }
  for (const limitation of evidence.limitations ?? []) info(style.gray(limitation));
}

async function commandExperiments(flags, positional) {
  if (positional.length) return fail("Use qrouter experiments to list definitions, or qrouter experiment <id> to inspect one.");
  const options = commonOptions(flags);
  const { client } = await authenticate({ ...options, allowPrompt: process.stdin.isTTY });
  const experiments = await client.listExperiments();
  if (flags.json) { data(JSON.stringify(experiments)); return 0; }
  blank();
  if (!experiments.length) info("No experiment definitions yet. Create one in the experiment workspace or SDK.");
  for (const experiment of experiments) rows([
    [experiment.definition?.name ?? experiment.id, experiment.id],
    ["version / intent", `${experiment.version} / ${experiment.definition?.execution_intent ?? "unknown"}`],
    ["campaign ceiling", money(experiment.definition?.max_total_cost, 6)],
  ]);
  blank();
  return 0;
}

async function commandExperiment(flags, positional) {
  const experimentId = positional[0];
  if (!experimentId || positional.length !== 1) return fail("Pass one experiment id: qrouter experiment <id>.");
  if ((flags.run !== undefined && flags.run !== true) || (flags.quote !== undefined && flags.quote !== true)) return fail("--run and --quote are boolean switches.");
  if (flags.run && flags.quote) return fail("Choose --quote or --run; a run always previews its own quote first.");
  const options = commonOptions(flags);
  const { client } = await authenticate({ ...options, allowPrompt: process.stdin.isTTY });
  const evidence = await client.getExperiment(experimentId);
  const experiment = evidence?.experiment;
  const definition = experiment?.definition;
  if (!definition || !/^[a-f0-9]{64}$/.test(experiment.definition_hash ?? "")) return fail("The server returned an invalid experiment definition or hash.");
  if (!flags.run && !flags.quote) {
    if (flags.json) data(JSON.stringify(evidence));
    else { blank(); renderExperimentEvidence(evidence); blank(); }
    return 0;
  }
  if (experiment.released_at) return fail("This experiment's circuit was released. Nothing was submitted.");
  const ceiling = definition.max_total_cost;
  if (!Number.isFinite(ceiling) || ceiling <= 0) return fail("The stored experiment ceiling is invalid. Nothing was submitted.");
  if (flags.run) {
    const approved = typeof flags["max-cost"] === "string" ? Number(flags["max-cost"]) : NaN;
    if (!Number.isFinite(approved) || approved !== ceiling) return fail(`--run requires --max-cost exactly equal to the stored campaign ceiling (${ceiling} USD). Nothing was submitted.`);
    if (flags.yes !== true && !process.stdin.isTTY) return fail("Refusing to run without confirmation. Pass --yes after reviewing the definition and quote.");
    if (flags["idempotency-key"] !== undefined && (typeof flags["idempotency-key"] !== "string" || flags["idempotency-key"].length < 8 || flags["idempotency-key"].length > 255)) return fail("--idempotency-key must contain 8–255 characters.");
  }
  const quote = await client.quoteExperiment(experimentId);
  if (quote?.definition_hash !== experiment.definition_hash || quote.max_total_cost !== ceiling) return fail("The quote does not match the reviewed definition and ceiling. Nothing was submitted.");
  if (quote.currency !== "usd" || !Number.isFinite(quote.total) || quote.total < 0) return fail("The preview did not return a valid USD total. Nothing was submitted.");
  if (!flags.run && flags.json) { data(JSON.stringify(quote)); return 0; }
  blank();
  renderExperimentEvidence({ experiment, runs: [] });
  rows([["preview total", money(quote.total, 6)], ["approved ceiling", money(ceiling, 6)]]);
  for (const execution of quote.executions ?? []) rows([[execution.selected_backend_id ?? execution.target, money(execution.quote?.total, 6)]]);
  info(quote.note ?? "Preview only. Costs are recalculated before reservation.");
  if (quote.within_budget !== true || quote.total > ceiling) return fail("The preview exceeds the campaign ceiling. Nothing was submitted.");
  if (!flags.run) return 0;
  if (flags.yes !== true) {
    const answer = ((await askOnce(`  ${accent(glyph.caret)} type ${style.bold("run")} to approve this definition and ceiling: `)) ?? "").trim().toLowerCase();
    if (answer !== "run") { info("Cancelled. Nothing was submitted."); return 0; }
  }
  const idempotencyKey = flags["idempotency-key"] ?? randomUUID();
  info(`Run idempotency key: ${idempotencyKey}. Reuse this key if the response is interrupted.`);
  const approval = { approved_definition_hash: experiment.definition_hash, approved_max_total_cost: ceiling };
  const result = await client.runExperiment(experimentId, approval, idempotencyKey);
  if (flags.json) data(JSON.stringify(result));
  else rows([["run", result.run?.id], ["execution group", result.run?.group_id], ["outcome", result.outcome]]);
  if (result.outcome === "awaiting_payment") { warn("The approved run is parked awaiting credits. Keep its run id and idempotency key."); return 1; }
  info(`Inspect evidence with: qrouter experiment ${experimentId}`);
  return 0;
}

async function commandStatus(flags, positional) {
  const options = commonOptions(flags);
  const jobId = positional[0];
  if (!jobId) return fail("Which job? Pass the id printed when it was submitted.");

  const { client, session } = await authenticate({ ...options, allowPrompt: process.stdin.isTTY });
  let job;
  try {
    job = await client.getJob(jobId);
  } catch (error) {
    return fail(error.message, { requestId: error instanceof ApiError ? error.requestId : undefined });
  }

  if (flags.wait && !["completed", "failed", "cancelled"].includes(job?.status)) {
    const progress = spinner(`${job.status}…`).start();
    const settled = await waitForJob({
      client,
      jobId,
      initial: job,
      timeoutMs: options.timeoutMs,
      onStatus: ({ status, elapsedMs }) => progress.update(`${status.replace(/_/g, " ")} ${style.gray(`${glyph.dot} ${duration(elapsedMs)}`)}`),
    });
    progress.stop();
    job = settled.job;
  }

  blank();
  const selected = job?.route_decision?.selected ?? {};
  rows([
    ["job", job?.id],
    ["status", job?.status],
    ["backend", selected.displayName ?? job?.selected_backend_id],
    ["provider", selected.provider],
    ["shots", job?.shots],
    ["quote", job?.quote?.total === undefined ? undefined : money(job.quote.total)],
    ["created", job?.created_at],
    ["completed", job?.completed_at],
    ["error", job?.error?.message],
  ]);
  blank();

  if (job?.status === "completed" && flags["no-save"] !== true) {
    const result = await loadResult(client, job);
    reportOutcome({
      job,
      result,
      circuit: { format: job.input_format, source: job.source ?? null },
      session,
      baseUrl: client.baseUrl,
      cliVersion: VERSION,
      outDir: options.outDir,
      includeSummary: options.includeSummary,
    });
    blank();
  }
  if (flags.json) data(JSON.stringify(job));
  return job?.status === "completed" || !job?.status ? 0 : 1;
}

async function commandCancel(flags, positional) {
  const options = commonOptions(flags);
  const jobId = positional[0];
  if (!jobId) return fail("Which job? Pass the id printed when it was submitted.");

  const { client } = await authenticate({ ...options, allowPrompt: process.stdin.isTTY });
  blank();
  try {
    await client.cancelJob(jobId);
  } catch (error) {
    return fail(error.message, { requestId: error instanceof ApiError ? error.requestId : undefined });
  }
  // Cancellation is a request to the provider, not an instant state change: the
  // job settles as `cancelled` once the provider acknowledges it.
  success(`Cancellation requested for ${jobId}. Reserved credits are released when it settles.`);
  info(style.gray(`Follow it with: qrouter status ${jobId} --wait`));
  blank();
  return 0;
}

async function commandBackends(flags) {
  const options = commonOptions(flags);
  const { session } = await authenticate({ ...options, allowPrompt: process.stdin.isTTY });
  if (flags.json) {
    data(JSON.stringify(session.backends));
    return 0;
  }
  blank();
  const ready = session.backends?.ready ?? [];
  if (ready.length === 0) {
    warn(`No backend is accepting jobs right now.`);
    if (session.backends?.reachable) {
      line(`  ${style.gray(`${session.backends.reachable} backend(s) are reachable but need execution credentials or a valid native rate on the server.`)}`);
    }
  } else {
    rows(
      ready.map((backend) => [
        backend.display_name ?? backend.id,
        `${style.gray(backend.id)}  ${backend.kind}  ${backend.qubits ?? "?"}q  ${
          backend.native_pricing?.kind === "per-shot"
            ? `${money(backend.native_pricing.usdPerTask, 6)}/task + ${money(backend.native_pricing.usdPerShot, 6)}/shot`
            : style.gray("native rate unavailable")
        }  ${style.gray(`queue ~${duration((backend.queue_seconds ?? 0) * 1000)}`)}`,
      ]),
      { indent: "  " },
    );
  }
  blank();
  return 0;
}

async function commandWhoami(flags) {
  const options = commonOptions(flags);
  const { session, key } = await authenticate({ ...options, allowPrompt: process.stdin.isTTY });
  if (flags.json) {
    data(JSON.stringify(session));
    return 0;
  }
  blank();
  describeSession(session, { key, baseUrl: options.baseUrl });
  info(`${style.gray(`key stored at ${configPath()}`)}`);
  info(`${style.gray(`results saved to ${downloadsDir({ override: options.outDir })}`)}`);
  blank();
  return 0;
}

async function commandLogin(flags) {
  const options = commonOptions(flags);
  banner();
  const { session, key, source } = await authenticate({ ...options, allowPrompt: true });
  describeSession(session, { key, baseUrl: options.baseUrl });
  if (source === "prompt") info(`${style.gray(`saved to ${configPath()}`)}`);
  else info(`${style.gray(`using the key from ${source === "env" ? "QROUTER_API_KEY" : source === "flag" ? "--key" : configPath()}`)}`);
  blank();
  return 0;
}

function commandLogout() {
  const removed = clearStoredKey();
  blank();
  if (removed) success(`Key removed from ${configPath()}`);
  else line(`  ${style.gray("No stored key to remove.")}`);
  if (process.env.QROUTER_API_KEY) {
    warn(`QROUTER_API_KEY is still set in this shell (${maskKey(process.env.QROUTER_API_KEY)}).`);
  }
  blank();
  return 0;
}

// ── entry ───────────────────────────────────────────────────────────────────

export async function main(argv = process.argv.slice(2)) {
  const { flags, positional } = parseArgs(argv);
  configureUi({ color: flags["no-color"] ? false : undefined, quiet: flags.json === true });

  if (flags.version) {
    data(VERSION);
    return 0;
  }

  const [command, ...rest] = positional;
  const known = ["experiments", "experiment", "chat", "run", "status", "cancel", "backends", "whoami", "session", "login", "logout", "help"];
  const resolved = known.includes(command) ? command : null;

  if (flags.help || resolved === "help") {
    line(USAGE);
    return 0;
  }

  const options = commonOptions(flags);

  try {
    switch (resolved) {
      case "experiments":
        return await commandExperiments(flags, rest);
      case "experiment":
        return await commandExperiment(flags, rest);
      case "run":
        return await commandRun(flags, rest);
      case "status":
        return await commandStatus(flags, rest);
      case "cancel":
        return await commandCancel(flags, rest);
      case "backends":
        return await commandBackends(flags);
      case "whoami":
      case "session":
        return await commandWhoami(flags);
      case "login":
        return await commandLogin(flags);
      case "logout":
        return commandLogout();
      case "chat": {
        banner();
        return await startChat({ ...options, firstMessage: rest.join(" ") || undefined });
      }
      default: {
        if (command) {
          // Unknown leading word: treat the whole invocation as a first message,
          // so `qrouter run a bell state` does the friendly thing.
          banner();
          return await startChat({ ...options, firstMessage: positional.join(" ") });
        }
        banner();
        return await startChat(options);
      }
    }
  } catch (error) {
    if (error?.code === "NO_KEY") return fail(error.message);
    if (error instanceof ApiError) return fail(error.message, { requestId: error.requestId });
    if (error?.name === "AbortError") return 130;
    return fail(error?.message ?? String(error));
  }
}
