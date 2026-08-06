// Line input that behaves the same interactively and under a pipe.
//
// `rl.question()` alone is not enough: with a non-TTY stdin readline starts
// flowing the moment the interface exists, so every line that arrives while the
// program is busy (streaming an assistant turn, waiting on a job) is emitted
// with no question pending and silently dropped — and then the interface closes
// at EOF, so the next question throws "readline was closed".
//
// This wrapper pauses the stream after every line and queues anything that
// arrives early, so `printf 'msg\nrun\n/exit\n' | qrouter` behaves exactly like
// a person typing those three lines.

import readline from "node:readline";
import process from "node:process";

/**
 * @param {{ input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream }} [streams]
 */
export function createPrompter(streams = {}) {
  const input = streams.input ?? process.stdin;
  const output = streams.output ?? process.stdout;
  const interactive = Boolean(input.isTTY);
  const rl = readline.createInterface({ input, output, terminal: interactive });

  const queued = [];
  let waiting = null;
  let closed = false;

  rl.on("line", (value) => {
    // Stop the flow so buffered input is not consumed ahead of the next ask().
    rl.pause();
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(value);
    } else {
      queued.push(value);
    }
  });

  rl.on("close", () => {
    closed = true;
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(null);
    }
  });

  return {
    rl,
    interactive,
    /** True once stdin has ended and nothing is buffered. */
    get done() {
      return closed && queued.length === 0;
    },
    /**
     * Asks for one line. Resolves to `null` at end of input, which callers
     * treat as "leave", never as an empty answer.
     */
    ask(question = "") {
      if (queued.length) return Promise.resolve(queued.shift());
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => {
        waiting = resolve;
        if (interactive) {
          rl.setPrompt(question);
          rl.prompt(); // also resumes the paused stream
        } else {
          if (question) output.write(question);
          rl.resume();
        }
      });
    },
    onInterrupt(handler) {
      rl.on("SIGINT", handler);
    },
    close() {
      if (!closed) rl.close();
    },
  };
}
