// The interactive assistant loop.
//
// Same conversation the console runs (`POST /api/chat`, streamed), rendered for
// a terminal: reasoning collapses to one live line, prose renders as it
// arrives, and a ```qrouter-proposal``` block becomes a confirmation prompt
// instead of a card. Nothing executes without an explicit `run`.

import process from "node:process";
import { ApiError } from "./api.mjs";
import { authenticate, describeSession } from "./auth.mjs";
import { configPath, maskKey, clearStoredKey } from "./config.mjs";
import { createMarkdownStream } from "./markdown.mjs";
import { createPrompter } from "./prompt.mjs";
import {
  loadResult,
  parseProposal,
  prepareProposal,
  renderProposalCard,
  reportOutcome,
  runJob,
} from "./proposal.mjs";
import { downloadsDir } from "./results.mjs";
import {
  accent,
  blank,
  duration,
  failure,
  glyph,
  line,
  money,
  rows,
  spinner,
  style,
  success,
  warn,
} from "./ui.mjs";

const HELP = [
  ["/help", "show this list"],
  ["/new", "start a fresh conversation"],
  ["/history", "list saved conversations (/history <n> opens one, delete <n> removes)"],
  ["/backends", "backends this key can run on right now"],
  ["/balance", "refresh credits and billing state"],
  ["/session", "full key + workspace summary"],
  ["/results", "where finished runs are saved"],
  ["/think", "show or hide the assistant's reasoning"],
  ["/key", "which key is in use, and where it is stored"],
  ["/logout", "forget the stored key and exit"],
  ["/exit", "leave (Ctrl+C also works)"],
];

/** The only answers that start a billed run. Anything else cancels. */
export const CONFIRMATIONS = new Set(["run", "y", "yes", "go", "confirm"]);

function printHelp() {
  blank();
  line(`  ${style.bold("Commands")}`);
  rows(HELP.map(([command, description]) => [command, style.gray(description)]), { indent: "  " });
  blank();
  line(`  ${style.gray("Anything else is sent to the assistant. Ask it to run something and it will")}`);
  line(`  ${style.gray("prepare a job you confirm before it executes.")}`);
  blank();
}

function printExamples() {
  line(`  ${style.gray("Try:")}`);
  for (const example of [
    "run a Bell state with 1024 shots on the best available backend",
    "run the quantum job at https://github.com/owner/repo using the qci cpu simulator",
    "what would 4096 shots of a 12-qubit QAOA circuit cost right now?",
  ]) {
    line(`    ${style.gray(glyph.caret)} ${style.gray(example)}`);
  }
  blank();
}

/**
 * Streams one assistant turn and renders it.
 * @returns {Promise<{ proposalRaw: string|null, aborted: boolean, error: string|null, threadId: string|null }>}
 */
async function streamTurn({ client, message, threadId, showThinking, signal }) {
  const startedAt = Date.now();
  const renderer = createMarkdownStream((text) => line(text));
  const thinking = spinner("thinking…").start();

  let thinkingActive = true;
  let thoughtMs = 0;
  let sawText = false;
  let error = null;
  let nextThreadId = threadId;

  const stopThinking = () => {
    if (!thinkingActive) return;
    thinkingActive = false;
    thoughtMs = Date.now() - startedAt;
    thinking.stop(
      thoughtMs > 1_200 ? `  ${style.gray(`${glyph.dot} reasoned for ${duration(thoughtMs)}`)}` : undefined,
    );
    if (thoughtMs > 1_200) blank();
  };

  try {
    for await (const event of client.chat({ message, threadId, signal })) {
      if (event.event === "meta") {
        if (event.data?.threadId && event.data.threadId !== "local") nextThreadId = event.data.threadId;
        continue;
      }
      if (event.event === "thought") {
        const text = event.data?.text ?? "";
        if (showThinking) {
          if (thinkingActive) {
            thinking.stop();
            thinkingActive = false;
          }
          process.stdout.write(style.gray(text));
        } else if (thinkingActive) {
          thinking.update(`thinking… ${style.gray(duration(Date.now() - startedAt))}`);
        }
        continue;
      }
      if (event.event === "text") {
        if (showThinking && !sawText) blank();
        stopThinking();
        sawText = true;
        renderer.push(event.data?.text ?? "");
        continue;
      }
      if (event.event === "error") {
        error = event.data?.message ?? "The assistant stream failed.";
        break;
      }
      // `usage`, `provider` and `done` carry no user-facing text.
    }
  } catch (streamError) {
    if (signal?.aborted) {
      stopThinking();
      renderer.end();
      blank();
      line(`  ${style.gray("stopped")}`);
      return { proposalRaw: null, aborted: true, error: null, threadId: nextThreadId };
    }
    error = streamError instanceof ApiError ? streamError.message : streamError.message ?? "The assistant stream failed.";
  } finally {
    stopThinking();
  }

  const { proposalRaw } = renderer.end();
  if (error) {
    blank();
    failure(error);
  }
  return { proposalRaw, aborted: false, error, threadId: nextThreadId };
}

/**
 * Quote → show → confirm → run → save.
 * Returns true when a job actually executed.
 */
export async function handleProposal({ client, session, proposalRaw, ask, context }) {
  const parsed = parseProposal(proposalRaw);
  blank();
  if (!parsed.ok) {
    warn(parsed.error);
    line(`  ${style.gray("Nothing was run. Ask again with the circuit spelled out, or use `qrouter run <file.qasm>`.")}`);
    blank();
    return false;
  }

  const { proposal } = parsed;
  let prepared;
  try {
    prepared = await prepareProposal({ client, proposal });
  } catch (error) {
    failure(`Could not price this job: ${error.message}`);
    if (error instanceof ApiError && error.requestId) line(`  ${style.gray(`request ${error.requestId}`)}`);
    blank();
    return false;
  }

  const balance = session?.credits?.available ?? null;
  const { insufficient } = renderProposalCard({ proposal, prepared, balance });
  blank();

  if (insufficient) {
    line(`  ${style.gray("Add credits before running. Nothing was submitted.")}`);
    blank();
    return false;
  }

  // End of input (null) is a decline, never an accidental yes.
  const answer = context?.autoConfirm
    ? "run"
    : ((await ask(`  ${accent(glyph.caret)} type ${style.bold("run")} to execute, anything else to cancel: `)) ?? "")
      .trim()
      .toLowerCase();

  if (!CONFIRMATIONS.has(answer)) {
    line(`  ${style.gray("Cancelled — nothing was run and nothing was charged.")}`);
    blank();
    return false;
  }

  blank();
  const progress = spinner("submitting…").start();
  let outcome;
  try {
    outcome = await runJob({
      client,
      proposal,
      prepared,
      timeoutMs: context?.timeoutMs,
      onStatus: ({ status, elapsedMs, advanceAvailable }) => {
        progress.update(
          `${status.replace(/_/g, " ")} ${style.gray(`${glyph.dot} ${duration(elapsedMs)}`)}${
            advanceAvailable ? "" : style.gray(` ${glyph.dot} waiting on the scheduler`)
          }`,
        );
      },
    });
  } catch (error) {
    progress.stop();
    failure(error.message);
    if (error instanceof ApiError && error.requestId) line(`  ${style.gray(`request ${error.requestId}`)}`);
    blank();
    return false;
  }
  progress.stop();

  if (outcome.blocked) {
    warn(`The job was accepted but cannot start: ${outcome.blocked}`);
    line(`  ${style.gray(`job ${outcome.jobId}`)}`);
    blank();
    return true;
  }

  if (outcome.timedOut) {
    warn(`Still running after ${duration(context?.timeoutMs ?? 15 * 60_000)}.`);
    line(`  ${style.gray(`Check on it later with: qrouter status ${outcome.jobId}`)}`);
    blank();
    return true;
  }

  const result = await loadResult(client, outcome.job);
  reportOutcome({
    job: outcome.job,
    result,
    circuit: { format: prepared.format, source: prepared.circuit, path: prepared.sourcePath },
    session,
    baseUrl: client.baseUrl,
    cliVersion: context?.version ?? "0.0.0",
    outDir: context?.outDir,
    includeSummary: context?.includeSummary !== false,
  });
  blank();
  return true;
}

/** The REPL. */
export async function startChat({ baseUrl, flagKey, version, outDir, includeSummary, timeoutMs, firstMessage }) {
  const authenticated = await authenticate({ baseUrl, flagKey, version });
  let { session } = authenticated;
  const { client, key } = authenticated;

  describeSession(session, { key, baseUrl });
  blank();

  if (session.assistant?.configured === false) {
    line(`  ${style.gray("Chat needs a language model on the server. You can still run circuits directly:")}`);
    line(`  ${style.gray("  qrouter run ./circuit.qasm --shots 1024")}`);
    blank();
    return 1;
  }

  line(`  ${style.gray(`Ask anything, or describe a job to run. ${style.bold("/help")} for commands.`)}`);
  blank();
  if (!firstMessage) printExamples();

  const prompter = createPrompter();
  const ask = (question) => prompter.ask(question);

  let threadId = null;
  let showThinking = false;
  let controller = null;
  let interrupts = 0;

  prompter.onInterrupt(() => {
    if (controller) {
      // Ctrl+C during a stream stops the stream, not the session.
      controller.abort();
      controller = null;
      return;
    }
    interrupts += 1;
    if (interrupts >= 2) {
      blank();
      prompter.close();
      return;
    }
    blank();
    line(`  ${style.gray("press Ctrl+C again, or type /exit, to leave")}`);
    prompter.rl.prompt();
  });

  let pending = firstMessage ? String(firstMessage) : null;

  for (;;) {
    let input;
    if (pending) {
      input = pending;
      pending = null;
      line(`  ${accent(glyph.caret)} ${input}`);
    } else {
      const answer = await ask(`  ${accent(glyph.caret)} `);
      if (answer === null) break; // end of input
      input = answer.trim();
      if (!prompter.interactive && input) line(input);
    }
    if (input) interrupts = 0;
    if (!input) continue;

    // ── slash commands ──────────────────────────────────────────────────────
    if (input.startsWith("/")) {
      const [command, ...args] = input.slice(1).split(/\s+/);
      const name = command.toLowerCase();

      if (["exit", "quit", "q"].includes(name)) break;
      if (name === "help") {
        printHelp();
        continue;
      }
      if (name === "new") {
        threadId = null;
        blank();
        line(`  ${style.gray("new conversation")}`);
        blank();
        continue;
      }
      if (name === "think") {
        showThinking = !showThinking;
        line(`  ${style.gray(`reasoning ${showThinking ? "shown" : "hidden"}`)}`);
        blank();
        continue;
      }
      if (name === "key") {
        line(`  ${style.gray("key")}    ${maskKey(key)}`);
        line(`  ${style.gray("stored")} ${configPath()}`);
        line(`  ${style.gray("server")} ${client.baseUrl}`);
        blank();
        continue;
      }
      if (name === "logout") {
        clearStoredKey();
        success(`Stored key removed from ${configPath()}`);
        blank();
        break;
      }
      if (name === "results") {
        line(`  ${style.gray("Finished runs are saved to")} ${accent(downloadsDir({ override: outDir }))}`);
        blank();
        continue;
      }
      if (["balance", "session", "backends"].includes(name)) {
        const refreshing = spinner("refreshing…").start();
        try {
          session = await client.session();
        } catch (error) {
          refreshing.stop();
          failure(error.message);
          blank();
          continue;
        }
        refreshing.stop();
        blank();
        if (name === "balance") {
          line(`  ${style.gray("credits")}   ${money(session.credits?.available, 2)} available${
            session.credits?.reserved ? style.gray(` ${glyph.dot} ${money(session.credits.reserved, 2)} reserved`) : ""
          }`);
          line(`  ${style.gray("billing")}   ${session.billing?.setup_complete ? "payment method on file" : "no payment method"}`);
        } else if (name === "backends") {
          const ready = session.backends?.ready ?? [];
          if (ready.length === 0) {
            warn(`No backend is accepting jobs right now.`);
          } else {
            rows(
              ready.map((backend) => [
                backend.display_name ?? backend.id,
                `${style.gray(backend.id)}  ${backend.kind}  ${backend.qubits ?? "?"}q  ${
                  backend.price_per_shot ? money(backend.price_per_shot, 6) : style.gray("—")
                }/shot  ${style.gray(`queue ~${duration((backend.queue_seconds ?? 0) * 1000)}`)}`,
              ]),
            );
          }
        } else {
          describeSession(session, { key, baseUrl: client.baseUrl });
        }
        blank();
        continue;
      }
      if (name === "history") {
        // `/history`, `/history 2`, `/history delete 2`
        const deleting = ["delete", "rm", "remove"].includes((args[0] ?? "").toLowerCase());
        const index = Number(deleting ? args[1] : args[0]);
        const loading = spinner("loading…").start();
        let data;
        try {
          data = await client.threads();
        } catch (error) {
          loading.stop();
          failure(error.message);
          blank();
          continue;
        }
        loading.stop();
        const threads = data?.threads ?? [];
        const selected = Number.isInteger(index) && index >= 1 && index <= threads.length ? threads[index - 1] : null;
        blank();

        if (data?.migrationNeeded) {
          line(`  ${style.gray("Saved history is not enabled on this deployment.")}`);
        } else if (threads.length === 0) {
          line(`  ${style.gray("No saved conversations yet.")}`);
        } else if (deleting) {
          if (!selected) {
            warn(`Which one? Use /history delete <number> — there ${threads.length === 1 ? "is 1 conversation" : `are ${threads.length} conversations`}.`);
          } else {
            try {
              await client.deleteThread(selected.id);
              if (threadId === selected.id) threadId = null;
              success(`Deleted “${selected.title}”.`);
            } catch (error) {
              failure(error.message);
            }
          }
        } else if (selected) {
          threadId = selected.id;
          success(`Continuing “${selected.title}”.`);
        } else {
          rows(threads.map((thread, position) => [`${position + 1}.`, thread.title]));
          line(`  ${style.gray("open one with /history <number>, remove one with /history delete <number>")}`);
        }
        blank();
        continue;
      }
      line(`  ${style.gray(`Unknown command /${name}. Try /help.`)}`);
      blank();
      continue;
    }

    // ── assistant turn ──────────────────────────────────────────────────────
    blank();
    controller = new AbortController();
    const turn = await streamTurn({
      client,
      message: input,
      threadId,
      showThinking,
      signal: controller.signal,
    });
    controller = null;
    threadId = turn.threadId ?? threadId;
    blank();

    if (turn.proposalRaw) {
      const ran = await handleProposal({
        client,
        session,
        proposalRaw: turn.proposalRaw,
        ask,
        context: { version, outDir, includeSummary, timeoutMs },
      });
      if (ran) {
        // Credits moved; keep the next proposal card honest.
        try {
          session = await client.session();
        } catch {
          /* the card falls back to "unknown" */
        }
      }
    }
  }

  prompter.close();
  blank();
  line(`  ${style.gray("bye")}`);
  blank();
  return 0;
}
