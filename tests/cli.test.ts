// Unit coverage for the terminal client (cli/). The modules under test are
// plain ESM with no dependencies, so they run here exactly as they do inside
// `npx qrouter.app`.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import { createSseParser } from "../cli/src/sse.mjs";
import { createMarkdownStream, renderInline, renderMarkdown } from "../cli/src/markdown.mjs";
import { parseProposal, explanationLines } from "../cli/src/proposal.mjs";
import {
  buildResultDocument,
  buildResultSummary,
  downloadsDir,
  resultStem,
  sanitizeSegment,
  saveResult,
  timestampSegment,
  uniquePath,
} from "../cli/src/results.mjs";
import { looksLikeApiKey, maskKey, resolveApiKey, resolveBaseUrl } from "../cli/src/config.mjs";
import { parseArgs } from "../cli/src/cli.mjs";
import { createPrompter } from "../cli/src/prompt.mjs";

const temporaryDirs: string[] = [];
function scratch() {
  const dir = mkdtempSync(path.join(tmpdir(), "qrouter-cli-"));
  temporaryDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (temporaryDirs.length) rmSync(temporaryDirs.pop()!, { recursive: true, force: true });
  delete process.env.QROUTER_API_KEY;
  delete process.env.QROUTER_BASE_URL;
  delete process.env.QROUTER_CONFIG_DIR;
  delete process.env.QROUTER_DOWNLOAD_DIR;
});

describe("sse parsing", () => {
  it("reassembles frames split across arbitrary chunk boundaries", () => {
    const parser = createSseParser();
    expect(parser.push("event: meta\ndata: {\"thread")).toEqual([]);
    expect(parser.push("Id\":\"abc\"}\n")).toEqual([]);
    const events = parser.push("\nevent: text\ndata: {\"text\":\"hi\"}\n\n");
    expect(events).toEqual([
      { event: "meta", data: { threadId: "abc" }, raw: '{"threadId":"abc"}' },
      { event: "text", data: { text: "hi" }, raw: '{"text":"hi"}' },
    ]);
  });

  it("handles CRLF frames, comments and multi-line data", () => {
    const parser = createSseParser();
    const events = parser.push(": keep-alive\r\n\r\nevent: text\r\ndata: line one\r\ndata: line two\r\n\r\n");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: "text", data: "line one\nline two" });
  });

  it("emits a trailing frame that never got its blank line", () => {
    const parser = createSseParser();
    parser.push("event: done\ndata: {\"ok\":true}");
    expect(parser.flush()).toEqual([{ event: "done", data: { ok: true }, raw: '{"ok":true}' }]);
  });
});

describe("markdown rendering", () => {
  it("captures a qrouter-proposal fence instead of printing it", () => {
    const { text, proposalRaw } = renderMarkdown(
      'Here is the plan.\n\n```qrouter-proposal\n{"shots":128}\n```\n',
    );
    expect(text).toContain("Here is the plan.");
    expect(text).not.toContain("shots");
    expect(JSON.parse(proposalRaw!)).toEqual({ shots: 128 });
  });

  it("captures a proposal even when the closing fence never arrives", () => {
    const { proposalRaw } = renderMarkdown('```qrouter-proposal\n{"shots":8}\n');
    expect(JSON.parse(proposalRaw!)).toEqual({ shots: 8 });
  });

  it("renders a line as soon as its newline arrives, and never twice", () => {
    const lines: string[] = [];
    const stream = createMarkdownStream((value) => lines.push(value), { columns: 80 });
    stream.push("first line\nsec");
    expect(lines.filter(Boolean)).toEqual(["  first line"]);
    stream.push("ond line\n");
    stream.end();
    expect(lines.filter(Boolean)).toEqual(["  first line", "  second line"]);
  });

  it("keeps ordinary code fences visible", () => {
    const { text } = renderMarkdown("```qasm\nh q[0];\n```\n");
    expect(text).toContain("h q[0];");
  });

  it("renders bullets, headings and tables", () => {
    const { text } = renderMarkdown("# Title\n- one\n- two\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n");
    expect(text).toContain("Title");
    expect(text).toMatch(/one/);
    expect(text).toMatch(/1\s+2/);
    // The separator row is layout, not data.
    expect(text).not.toContain("---");
  });

  it("shows link targets rather than hiding them behind labels", () => {
    expect(renderInline("[billing](https://qrouter.app/dashboard/billing)")).toContain(
      "https://qrouter.app/dashboard/billing",
    );
  });
});

describe("proposal validation", () => {
  const base = { circuit: "OPENQASM 2.0;", shots: 1024 };

  /** Narrows the result union and fails loudly with the rejection reason. */
  function accepted(raw: string) {
    const parsed = parseProposal(raw);
    if (!parsed.ok) throw new Error(`expected an acceptable proposal, got: ${parsed.error}`);
    return parsed.proposal;
  }

  function rejected(raw: string) {
    const parsed = parseProposal(raw);
    if (parsed.ok) throw new Error("expected the proposal to be rejected");
    return parsed.error;
  }

  it("accepts an inline circuit and fills in defaults", () => {
    expect(accepted(JSON.stringify(base))).toMatchObject({
      format: "openqasm2",
      shots: 1024,
      target: "auto",
      routing_mode: "balanced",
      repository: null,
    });
  });

  it("rejects a proposal with no circuit at all", () => {
    expect(rejected(JSON.stringify({ shots: 10 }))).toMatch(/neither inline OpenQASM nor a repository/);
  });

  it("rejects malformed JSON rather than throwing", () => {
    expect(rejected("{not json")).toMatch(/not valid JSON/);
  });

  it("rejects out-of-range shot counts before they reach the API", () => {
    expect(rejected(JSON.stringify({ ...base, shots: 0 }))).toMatch(/outside the accepted range/);
    expect(rejected(JSON.stringify({ ...base, shots: 5_000_000 }))).toMatch(/outside the accepted range/);
  });

  it("falls back to safe values for unknown routing modes and formats", () => {
    const proposal = accepted(JSON.stringify({ ...base, routing_mode: "cheapest", format: "qir" }));
    expect(proposal.routing_mode).toBe("balanced");
    expect(proposal.format).toBe("openqasm2");
  });

  it("prefers the inline circuit when a model sends both sources", () => {
    const proposal = accepted(
      JSON.stringify({ ...base, repository: { url: "https://github.com/a/b", path: "c.qasm" } }),
    );
    expect(proposal.circuit).toBe("OPENQASM 2.0;");
    expect(proposal.repository).toBeNull();
  });

  it("accepts a repository-only proposal", () => {
    const proposal = accepted(
      JSON.stringify({ repository: { url: "https://github.com/a/b", path: "c.qasm", ref: "main" } }),
    );
    expect(proposal.repository).toEqual({ url: "https://github.com/a/b", path: "c.qasm", ref: "main" });
  });

  it("treats the router's explanation array as separate lines", () => {
    expect(explanationLines(["one.", "two."])).toEqual(["one.", "two."]);
    expect(explanationLines("solo.")).toEqual(["solo."]);
    expect(explanationLines(null)).toEqual([]);
  });
});

describe("result files", () => {
  it("labels the file with the provider, as requested", () => {
    const stem = resultStem({ provider: "IonQ", at: new Date(2026, 7, 6, 22, 58, 1) });
    expect(stem).toBe("qrouter quantum results ___ionq___ 2026-08-06 22-58-01");
  });

  it("strips path separators and control characters from the provider name", () => {
    expect(sanitizeSegment("ibm/quantum:eu")).toBe("ibm quantum eu");
    expect(sanitizeSegment("")).toBe("unknown");
    expect(resultStem({ provider: "../../etc" })).not.toContain("..");
  });

  it("produces a Windows-legal timestamp", () => {
    expect(timestampSegment(new Date(2026, 0, 2, 3, 4, 5))).toBe("2026-01-02 03-04-05");
  });

  it("never overwrites an earlier run", () => {
    const dir = scratch();
    writeFileSync(path.join(dir, "run.json"), "{}");
    expect(path.basename(uniquePath(dir, "run", ".json"))).toBe("run (2).json");
  });

  it("writes a JSON document and a readable companion that stay paired", () => {
    const dir = scratch();
    const document = buildResultDocument({
      job: {
        id: "job-1",
        status: "completed",
        shots: 1024,
        selected_backend_id: "qci-aer-gpu",
        quote: { total: 0.0182 },
        route_decision: {
          selected: { id: "qci-aer-gpu", displayName: "QCI Aer CPU", provider: "qci", kind: "simulator" },
          explanation: ["Passed every constraint.", "Balanced score: 40."],
          candidates: [],
        },
        result: { counts: { "00": 512, "11": 512 } },
      },
      result: { counts: { "00": 512, "11": 512 }, shots: 1024 },
      circuit: { format: "openqasm2", source: "OPENQASM 2.0;" },
      session: { organization: { name: "Acme" } },
      baseUrl: "https://qrouter.app",
      cliVersion: "0.1.0",
    });

    // Same second twice: the pair must not collide or split apart.
    const first = saveResult({ document, dir, at: new Date(2026, 7, 6, 12, 0, 0) });
    const second = saveResult({ document, dir, at: new Date(2026, 7, 6, 12, 0, 0) });
    expect(path.basename(first.jsonPath)).toBe("qrouter quantum results ___qci___ 2026-08-06 12-00-00.json");
    expect(path.basename(second.jsonPath)).toBe("qrouter quantum results ___qci___ 2026-08-06 12-00-00 (2).json");
    expect(path.basename(second.summaryPath!)).toBe("qrouter quantum results ___qci___ 2026-08-06 12-00-00 (2).txt");

    const written = JSON.parse(readFileSync(first.jsonPath, "utf8"));
    expect(written.routing).toMatchObject({ provider: "qci", backend_id: "qci-aer-gpu" });
    expect(written.result.counts).toEqual({ "00": 512, "11": 512 });
    expect(written.circuit.source).toBe("OPENQASM 2.0;");
  });

  it("renders the router's reasoning as lines, not a comma-glued array", () => {
    const summary = buildResultSummary({
      job: { id: "j", status: "completed", shots: 10 },
      routing: { provider: "qci", explanation: ["One.", "Two."] },
      result: { counts: { "0": 10 } },
      quote: { total: 1 },
      organization: { name: "Acme" },
      source: { version: "0.1.0", base_url: "https://qrouter.app" },
    });
    expect(summary).toContain("  One.\n  Two.");
    expect(summary).not.toContain("One.,Two.");
  });

  it("honours QROUTER_DOWNLOAD_DIR and an explicit override", () => {
    const dir = scratch();
    process.env.QROUTER_DOWNLOAD_DIR = dir;
    expect(downloadsDir()).toBe(dir);
    const other = scratch();
    expect(downloadsDir({ override: other })).toBe(other);
  });
});

describe("key handling", () => {
  it("masks a key down to a recognisable prefix", () => {
    const masked = maskKey("qci_live_abcdefghijklmnop");
    expect(masked.startsWith("qci_live_abcd")).toBe(true);
    expect(masked).not.toContain("efghijklmnop");
  });

  it("recognises live, test and the local development key", () => {
    expect(looksLikeApiKey("qci_live_AbCd1234efgh")).toBe(true);
    expect(looksLikeApiKey("qci_test_local_development")).toBe(true);
    expect(looksLikeApiKey("sk-not-a-qrouter-key")).toBe(false);
    expect(looksLikeApiKey("qci_live_short")).toBe(false);
  });

  it("prefers --key over the environment over the stored file", () => {
    const dir = scratch();
    process.env.QROUTER_CONFIG_DIR = dir;
    writeFileSync(path.join(dir, "config.json"), JSON.stringify({ apiKey: "qci_live_fromfile" }));
    expect(resolveApiKey({}).source).toBe("file");
    process.env.QROUTER_API_KEY = "qci_live_fromenv";
    expect(resolveApiKey({})).toEqual({ key: "qci_live_fromenv", source: "env" });
    expect(resolveApiKey({ flagKey: "qci_live_fromflag" })).toEqual({ key: "qci_live_fromflag", source: "flag" });
  });

  it("defaults to qrouter.app and strips trailing slashes", () => {
    expect(resolveBaseUrl({})).toBe("https://qrouter.app");
    expect(resolveBaseUrl({ flagBaseUrl: "http://localhost:3000/" })).toBe("http://localhost:3000");
  });
});

describe("argument parsing", () => {
  it("supports --flag value, --flag=value and bare booleans", () => {
    const { flags, positional } = parseArgs(["run", "bell.qasm", "--shots", "2048", "--mode=speed", "--yes"]);
    expect(positional).toEqual(["run", "bell.qasm"]);
    expect(flags).toMatchObject({ shots: "2048", mode: "speed", yes: true });
  });

  it("treats a value-less trailing flag as a boolean", () => {
    expect(parseArgs(["--json"]).flags).toEqual({ json: true });
    expect(parseArgs(["backends", "--json", "--key"]).flags).toEqual({ json: true, key: true });
  });

  it("stops parsing flags after --", () => {
    expect(parseArgs(["chat", "--", "--not-a-flag"]).positional).toEqual(["chat", "--not-a-flag"]);
  });
});

describe("prompting", () => {
  it("queues input that arrives before it is asked for", async () => {
    // This is the piped case: all three lines land at once, long before the
    // second and third questions exist.
    const input = new PassThrough() as unknown as NodeJS.ReadableStream;
    const output = new PassThrough();
    const prompter = createPrompter({ input, output });
    (input as unknown as PassThrough).write("first\nsecond\nthird\n");
    (input as unknown as PassThrough).end();

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await prompter.ask("> ")).toBe("first");
    expect(await prompter.ask("> ")).toBe("second");
    expect(await prompter.ask("> ")).toBe("third");
    // End of input reads as "no answer", which callers treat as a decline.
    expect(await prompter.ask("> ")).toBeNull();
    prompter.close();
  });
});
