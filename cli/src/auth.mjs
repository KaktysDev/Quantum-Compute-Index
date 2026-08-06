// Paste a key, prove it works, say what it can do.
//
// The whole point of the terminal client is that this is the only setup step,
// so it has to be honest: a key that authenticates but cannot reach a backend,
// cannot pay, or has no assistant configured is reported here, not three
// prompts later when a job fails.

import process from "node:process";
import { ApiError, createClient } from "./api.mjs";
import { looksLikeApiKey, maskKey, resolveApiKey, writeConfig } from "./config.mjs";
import {
  accent,
  blank,
  failure,
  glyph,
  info,
  line,
  money,
  spinner,
  style,
  success,
  warn,
} from "./ui.mjs";

export function banner() {
  blank();
  line(`  ${accent(style.bold("QROUTER"))}  ${style.gray("one API key for quantum compute")}`);
  blank();
}

/**
 * Reads a secret without echoing it.
 *
 * Paste arrives as one multi-byte chunk rather than per-key events, so the
 * handler appends whole chunks and filters control bytes instead of assuming
 * one keypress per event.
 */
export function promptSecret(question) {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) {
    // Piped input: `echo $KEY | qrouter` should still work.
    return new Promise((resolve, reject) => {
      let buffer = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (chunk) => {
        buffer += chunk;
      });
      stdin.once("end", () => resolve(buffer.split("\n")[0].trim()));
      stdin.once("error", reject);
    });
  }

  return new Promise((resolve, reject) => {
    stdout.write(question);
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";

    const done = (result, error) => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(Boolean(wasRaw));
      stdin.pause();
      stdout.write("\n");
      if (error) reject(error);
      else resolve(result);
    };

    const onData = (chunk) => {
      for (const character of chunk) {
        switch (character) {
          case "\r":
          case "\n":
            return done(value.trim());
          case "\u0003": // Ctrl+C
            stdout.write("\n");
            stdin.setRawMode(Boolean(wasRaw));
            process.exit(130);
            return undefined;
          case "\u0004": // Ctrl+D
            return done(value.trim());
          case "\u0015": // Ctrl+U clears the line
            stdout.write(`\r${" ".repeat(question.length + value.length + 2)}\r${question}`);
            value = "";
            break;
          case "\u007F": // Backspace
          case "\b":
            if (value.length) {
              value = value.slice(0, -1);
              stdout.write("\b \b");
            }
            break;
          default:
            // Skip escape sequences (arrow keys, bracketed paste markers) and
            // any other control byte; keep everything printable.
            if (character >= " " && character !== "\u007F") {
              value += character;
              stdout.write(style.gray("•"));
            }
            break;
        }
      }
      return undefined;
    };

    stdin.on("data", onData);
  });
}

/** Human-readable summary of what this key just proved it can do. */
export function describeSession(session, { key, baseUrl } = {}) {
  const environment = session.principal?.environment;
  const credits = session.credits?.available;
  const ready = session.backends?.ready ?? [];

  success(
    `${style.bold(session.organization?.name ?? "your workspace")}` +
      `${environment ? style.gray(` ${glyph.dot} ${environment} key`) : ""}` +
      `${key ? style.gray(` ${glyph.dot} ${maskKey(key)}`) : ""}`,
  );
  success(
    `${credits === null || credits === undefined ? "credit balance unknown" : `${money(credits, 2)} in credits`}` +
      `${session.billing?.setup_complete ? style.gray(` ${glyph.dot} payment method on file`) : ""}`,
  );

  if (ready.length === 0) {
    warn(`No backend is currently accepting jobs${
      session.backends?.reachable ? " — the reachable ones need provider credentials on the server." : "."
    }`);
  } else {
    const names = ready.slice(0, 3).map((backend) => backend.display_name ?? backend.id);
    const extra = ready.length > names.length ? style.gray(` +${ready.length - names.length} more`) : "";
    success(`${ready.length} backend${ready.length === 1 ? "" : "s"} ready: ${names.join(", ")}${extra}`);
  }

  if (environment === "test") {
    info(style.gray("Test keys run on simulators only. Use a live key for hardware."));
  }
  if (credits === 0) {
    warn(`No credits available — add some at https://qrouter.app/dashboard/billing before running.`);
  }
  if (session.assistant?.configured === false) {
    warn(`The assistant is not configured on ${baseUrl ?? "this deployment"}; \`qrouter run\` still works.`);
  }
}

async function verify(client) {
  const checking = spinner("verifying your key…").start();
  try {
    return await client.session();
  } finally {
    checking.stop();
  }
}

/**
 * Resolves a working key + verified session, prompting when necessary.
 * @returns {Promise<{ client: any, session: any, key: string }>}
 */
export async function authenticate({ baseUrl, flagKey, version, allowPrompt = true, save = true }) {
  let { key, source } = resolveApiKey({ flagKey });
  let attempts = 0;

  for (;;) {
    if (!key) {
      if (!allowPrompt) {
        const error = new Error(
          "No API key found. Pass --key, set QROUTER_API_KEY, or run `qrouter login`.",
        );
        error.code = "NO_KEY";
        throw error;
      }
      line(`  ${style.gray("Create one at https://qrouter.app/dashboard/api-keys — it is pasted once and stored locally.")}`);
      blank();
      key = await promptSecret(`  ${accent(glyph.caret)} Paste your QRouter API key: `);
      source = "prompt";
      if (!key) {
        failure(`No key entered.`);
        blank();
        key = null;
        attempts += 1;
        if (attempts >= 3) throw new Error("No API key was provided.");
        continue;
      }
      if (!looksLikeApiKey(key)) {
        warn(`That does not look like a QRouter key (they start with ${style.bold("qci_live_")} or ${style.bold("qci_test_")}). Trying it anyway…`);
      }
    }

    const client = createClient({ baseUrl, apiKey: key, version });
    try {
      const session = await verify(client);
      if (save && source === "prompt") {
        try {
          writeConfig({ apiKey: key, baseUrl });
        } catch (error) {
          warn(`Could not save the key for next time: ${error.message}`);
        }
      }
      return { client, session, key, source };
    } catch (error) {
      attempts += 1;
      if (error instanceof ApiError && error.status === 401) {
        failure(error.message);
        if (source === "env") {
          throw new Error("The key in QROUTER_API_KEY was rejected. Unset it or replace it with a valid key.");
        }
        if (source === "flag") throw new Error("The key passed with --key was rejected.");
        if (!allowPrompt || attempts >= 3) throw new Error("Could not authenticate with the key provided.");
        blank();
        key = null;
        continue;
      }
      throw error;
    }
  }
}
