// HTTP client for the QRouter platform.
//
// One rule shapes this file: the CLI never decides anything the server decides.
// It does not price, it does not choose a backend, it does not guess whether a
// key may run on hardware. It asks /api/chat/quote, /api/v1/jobs and
// /api/v1/session, and renders their answers.

import { readSse } from "./sse.mjs";

export class ApiError extends Error {
  constructor(message, { status = 0, type = null, requestId = null, body = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.type = type;
    this.requestId = requestId;
    this.body = body;
  }
}

const USER_AGENT = "qrouter-cli";

function describeNetworkError(error, url) {
  const cause = error?.cause?.code || error?.code;
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  })();
  if (cause === "ENOTFOUND" || cause === "EAI_AGAIN") return `Cannot resolve ${host}. Check your network or --base-url.`;
  if (cause === "ECONNREFUSED") return `${host} refused the connection. Is the server running?`;
  if (cause === "CERT_HAS_EXPIRED" || cause === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") return `TLS verification failed for ${host}.`;
  if (error?.name === "TimeoutError" || cause === "UND_ERR_HEADERS_TIMEOUT") return `${host} did not respond in time.`;
  if (error?.name === "AbortError") return "Request cancelled.";
  return `Could not reach ${host}: ${error?.message ?? "network error"}`;
}

export function createClient({ baseUrl, apiKey, version = "0.0.0" }) {
  const root = String(baseUrl).replace(/\/+$/, "");

  const headers = (extra = {}) => ({
    authorization: `Bearer ${apiKey}`,
    "user-agent": `${USER_AGENT}/${version}`,
    "x-qrouter-client": "cli",
    ...extra,
  });

  async function raise(response) {
    const requestId = response.headers.get("x-request-id");
    let body = null;
    let message = `Request failed with HTTP ${response.status}.`;
    let type = null;
    try {
      const text = await response.text();
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }
    } catch {
      /* body already consumed or empty */
    }
    if (body && typeof body === "object") {
      // v1 uses { error: { message, type } }; v2 uses RFC 7807.
      message = body.error?.message || body.detail || body.title || message;
      type = body.error?.type || body.type || null;
    } else if (typeof body === "string" && body.trim()) {
      const text = body.trim();
      // A proxy, a crashed dev server, or a captive portal answers with a whole
      // HTML document. Printing 400 characters of markup into a terminal tells
      // the user nothing, so say what actually happened instead.
      if (/^\s*(<!doctype|<html)/i.test(text)) {
        type = "unexpected_response";
        message =
          `${new URL(response.url || root).host} returned an HTML page instead of JSON (HTTP ${response.status}). ` +
          "The server is likely erroring or something is intercepting the request.";
      } else {
        message = text.slice(0, 300);
      }
    }
    throw new ApiError(message, { status: response.status, type, requestId, body });
  }

  async function request(path, { method = "GET", body, timeoutMs = 30_000, signal, extraHeaders } = {}) {
    const url = `${root}${path}`;
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: headers({
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...extraHeaders,
        }),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ?? (timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined),
      });
    } catch (error) {
      throw new ApiError(describeNetworkError(error, url), { status: 0, type: "network_error" });
    }
    if (!response.ok) await raise(response);
    if (response.status === 204) return null;
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  return {
    baseUrl: root,

    /** Identity, credits, and which backends this key can actually reach. */
    session: () => request("/api/v1/session"),

    threads: () => request("/api/chat"),
    thread: (id) => request(`/api/chat?thread=${encodeURIComponent(id)}`),
    deleteThread: (id) => request(`/api/chat?thread=${encodeURIComponent(id)}`, { method: "DELETE" }),

    /** Lists the .qasm files (and any qrouter.json) in a GitHub repository. */
    inspectRepository: ({ repository, ref }) => {
      const params = new URLSearchParams({ repository });
      if (ref) params.set("ref", ref);
      return request(`/api/v1/repositories/inspect?${params}`, { timeoutMs: 45_000 });
    },

    /** Resolves a repository-referenced circuit into OpenQASM text. */
    repositoryCircuit: ({ repository, path: filePath, ref }) => {
      const params = new URLSearchParams({ repository, path: filePath });
      if (ref) params.set("ref", ref);
      return request(`/api/chat/circuit?${params}`, { timeoutMs: 45_000 });
    },

    /** Real routing + pricing, no execution. The number the user confirms. */
    quote: (payload) => request("/api/chat/quote", { method: "POST", body: payload, timeoutMs: 90_000 }),

    createJob: (payload, idempotencyKey) =>
      request("/api/v1/jobs", {
        method: "POST",
        body: payload,
        timeoutMs: 120_000,
        extraHeaders: idempotencyKey ? { "idempotency-key": idempotencyKey } : undefined,
      }),

    getJob: (id) => request(`/api/v1/jobs/${encodeURIComponent(id)}`),

    /** Drives one owned job forward when no fleet scheduler is deployed. */
    advanceJob: (id) => request(`/api/v1/jobs/${encodeURIComponent(id)}/advance`, { method: "POST", timeoutMs: 120_000 }),

    jobResult: (id) => request(`/api/v1/jobs/${encodeURIComponent(id)}/result`),

    cancelJob: (id) => request(`/api/v1/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" }),

    backends: () => request("/api/v1/backends"),

    /**
     * Streams one assistant turn.
     * @returns {AsyncGenerator<{event: string, data: any}>}
     */
    async *chat({ message, threadId, signal }) {
      const url = `${root}/api/chat`;
      let response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: headers({ "content-type": "application/json", accept: "text/event-stream" }),
          body: JSON.stringify({ message, threadId: threadId ?? undefined, surface: "cli" }),
          signal,
        });
      } catch (error) {
        throw new ApiError(describeNetworkError(error, url), { status: 0, type: "network_error" });
      }
      if (!response.ok) await raise(response);
      yield* readSse(response);
    },
  };
}
