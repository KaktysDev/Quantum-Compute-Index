import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main, parseArgs } from "../cli/src/cli.mjs";
import { QRouterV2 } from "../sdk/typescript/src/index";

const id = "7d2029e0-c33a-46bd-b60c-07887d3517b7";
const hash = "a".repeat(64);
const evidence = {
  schema_version: "experiment-evidence/1",
  experiment: { id, version: 1, definition_hash: hash, source_hash: "b".repeat(64), released_at: null,
    definition: { name: "Bell campaign", objective: "Check Bell correlation", execution_intent: "simulate", targets: ["qci-aer-gpu"], shots: 1024, max_total_cost: 1 } },
  runs: [], limitations: ["A completed job alone does not establish correctness."],
};
const quote = { definition_hash: hash, total: 0.02, max_total_cost: 1, within_budget: true, currency: "usd", executions: [], note: "No jobs submitted." };
const accepted = { run: { id: "run-1", group_id: "group-1" }, group: { status: "running" }, outcome: "queued", replayed: false };
const args = (command: string[]) => [...command, "--key", "qci_test_local_development", "--base-url", "https://qrouter.test", "--json", "--no-color"];
let calls: Array<{ path: string; method: string; body: unknown; headers: Headers }>;
let stdout: string;
let stderr: string;
let stdinTty: PropertyDescriptor | undefined;

function mockService(preview = quote) {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const pathname = new URL(String(input)).pathname;
    calls.push({ path: pathname, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: new Headers(init?.headers) });
    if (pathname === "/api/v1/session") return Response.json({ organization: { name: "Mock workspace" } });
    if (pathname === "/api/v2/experiments" && (init?.method ?? "GET") === "GET") return Response.json({ data: [evidence.experiment] });
    if (pathname === `/api/v2/experiments/${id}`) return Response.json({ data: evidence });
    if (pathname === `/api/v2/experiments/${id}/quote`) return Response.json({ data: preview });
    if (pathname === `/api/v2/experiments/${id}/run`) return Response.json({ data: accepted }, { status: 202 });
    throw new Error(`Unexpected mocked request: ${pathname}`); // No fallback to a live service.
  }));
}

beforeEach(() => {
  calls = []; stdout = ""; stderr = "";
  stdinTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  vi.spyOn(process.stdout, "write").mockImplementation(((text: string) => { stdout += text; return true; }) as typeof process.stdout.write);
  vi.spyOn(process.stderr, "write").mockImplementation(((text: string) => { stderr += text; return true; }) as typeof process.stderr.write);
  mockService();
});

afterEach(() => {
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  if (stdinTty) Object.defineProperty(process.stdin, "isTTY", stdinTty);
  else Reflect.deleteProperty(process.stdin, "isTTY");
});

describe("experiment CLI approval boundary", () => {
  it("parses quote and run as switches without consuming an id", () => {
    expect(parseArgs(["experiment", "--quote", id]).positional).toEqual(["experiment", id]);
    expect(parseArgs(["experiment", "--run", id, "--yes"]).flags).toMatchObject({ run: true, yes: true });
  });

  it("lists experiments and reads evidence without submitting any jobs", async () => {
    expect(await main(args(["experiments"]))).toBe(0);
    expect(JSON.parse(stdout)).toEqual([evidence.experiment]);
    stdout = "";
    expect(await main(args(["experiment", id]))).toBe(0);
    expect(JSON.parse(stdout)).toEqual(evidence);
    expect(calls.every((request) => request.method === "GET")).toBe(true);
  });

  it("previews without run approval and does not execute", async () => {
    expect(await main(args(["experiment", id, "--quote"]))).toBe(0);
    expect(JSON.parse(stdout)).toEqual(quote);
    expect(calls.some((request) => request.path.endsWith("/run"))).toBe(false);
  });

  it("refuses a run without an explicit exact ceiling or confirmation", async () => {
    for (const options of [["--yes"], ["--yes", "--max-cost", "2"], ["--max-cost", "1"]]) {
      expect(await main(args(["experiment", id, "--run", ...options]))).toBe(1);
    }
    expect(calls.some((request) => request.path.endsWith("/run"))).toBe(false);
    expect(stderr).toContain("Nothing was submitted");
    expect(stderr).toContain("Refusing to run without confirmation");
  });

  it("prints the preview and refuses a quote above the approved ceiling", async () => {
    mockService({ ...quote, total: 1.01, within_budget: false });
    expect(await main(args(["experiment", id, "--run", "--yes", "--max-cost", "1"]))).toBe(1);
    expect(stderr).toContain("preview total");
    expect(stderr).toContain("exceeds the campaign ceiling");
    expect(calls.some((request) => request.path.endsWith("/run"))).toBe(false);
  });

  it("rejects a preview for a different immutable definition", async () => {
    mockService({ ...quote, definition_hash: "c".repeat(64) });
    expect(await main(args(["experiment", id, "--run", "--yes", "--max-cost", "1"]))).toBe(1);
    expect(calls.some((request) => request.path.endsWith("/run"))).toBe(false);
  });

  it("submits only the reviewed hash and exact ceiling with the caller's retry key", async () => {
    expect(await main(args(["experiment", id, "--run", "--yes", "--max-cost", "1", "--idempotency-key", "campaign-run-001"]))).toBe(0);
    const submission = calls.find((request) => request.path.endsWith("/run"))!;
    expect(submission.body).toEqual({ approved_definition_hash: hash, approved_max_total_cost: 1 });
    expect(submission.headers.get("idempotency-key")).toBe("campaign-run-001");
    expect(calls.findIndex((request) => request.path.endsWith("/quote"))).toBeLessThan(calls.indexOf(submission));
    expect(JSON.parse(stdout)).toEqual(accepted);
  });
});

describe("TypeScript experiment SDK", () => {
  it("forwards explicit run approval and preserves a parked run without silently retrying", async () => {
    const sdk = new QRouterV2("qci_test_mock", "https://qrouter.test");
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://qrouter.test/api/v2/experiments/encoded%2Fid/run");
      expect(JSON.parse(String(init?.body))).toEqual({ approved_definition_hash: hash, approved_max_total_cost: 1 });
      expect(new Headers(init?.headers).get("idempotency-key")).toBe("run-retry-001");
      return Response.json({ data: { ...accepted, outcome: "awaiting_payment" } }, { status: 402 });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect((await sdk.experiments.run("encoded/id", { approved_definition_hash: hash, approved_max_total_cost: 1 }, "run-retry-001")).outcome).toBe("awaiting_payment");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("exposes list, definition creation, evidence, and quote as separate calls", async () => {
    const sdk = new QRouterV2("qci_test_mock", "https://qrouter.test");
    const input = { ...evidence.experiment.definition, circuit_id: id, reference: { kind: "none" as const, reason: "No reference available." }, success_criterion: { metric: "record_only" as const }, execution_intent: "simulate" as const };
    const observed: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
      observed.push(`${init?.method ?? "GET"} ${new URL(String(request)).pathname}`);
      if (init?.body) {
        expect(JSON.parse(String(init.body))).toEqual(input);
        expect(new Headers(init.headers).get("idempotency-key")).toBe("definition-001");
      }
      return Response.json({ data: init?.body ? evidence.experiment : String(request).endsWith("/quote") ? quote : String(request).endsWith(id) ? evidence : [evidence.experiment] });
    }));
    await sdk.experiments.list(); await sdk.experiments.create(input, "definition-001");
    await sdk.experiments.get(id); await sdk.experiments.quote(id);
    expect(observed).toEqual(["GET /api/v2/experiments", "POST /api/v2/experiments", `GET /api/v2/experiments/${id}`, `POST /api/v2/experiments/${id}/quote`]);
  });
});
