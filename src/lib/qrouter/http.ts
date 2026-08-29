import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { AIInferenceError } from "@/lib/ai/inference";
import { logRedactedError } from "@/lib/security/log";
import { AuthenticationError, RateLimitError } from "./auth";
import { BackendUnavailableError, resolutionFor } from "./availability";
import { CircuitValidationError } from "./analyze";
import { EncodingError } from "./encoding/types";
import { RepositorySourceError } from "./repositories";
import { TranspilerUnavailableError } from "./transpiler";

/**
 * v1 error responder. The modelled error classes below carry messages that are
 * part of the live v1 contract, so they are forwarded verbatim; anything else is
 * an internal failure whose message may quote Postgres/Supabase text (and with
 * it customer rows), so it collapses to a fixed string plus a request id.
 *
 * `requestIdValue` is optional because ~30 route files call `apiError(error)`.
 */
export function apiError(error: unknown, requestIdValue?: string) {
  const id = requestIdValue?.trim().slice(0, 128) || randomUUID();
  const headers = { "x-request-id": id };

  if (error instanceof AuthenticationError) {
    return NextResponse.json({ error: { type: "authentication_error", message: error.message } }, { status: 401, headers });
  }
  if (error instanceof RateLimitError) {
    return NextResponse.json(
      { error: { type: "rate_limit_error", message: error.message } },
      { status: 429, headers: { ...headers, "retry-after": String(error.retryAfterSeconds) } },
    );
  }
  if (error instanceof CircuitValidationError) {
    return NextResponse.json({ error: { type: "invalid_circuit", message: error.message, details: error.details } }, { status: 422, headers });
  }
  if (error instanceof EncodingError) {
    return NextResponse.json({ error: { type: "unsupported_encoding", message: error.message } }, { status: 422, headers });
  }
  if (error instanceof RepositorySourceError) {
    return NextResponse.json({ error: { type: error.type, message: error.message } }, { status: error.status, headers });
  }
  if (error instanceof AIInferenceError) {
    const status = error.code === "not_configured"
      ? 503
      : error.status === 504
        ? 504
        : error.status === 429
          ? 503
          : 502;
    return NextResponse.json({
      error: {
        type: error.code === "not_configured" ? "configuration_error" : "upstream_ai_error",
        message: error.message,
        provider: error.provider,
        code: error.code,
      },
    }, { status, headers });
  }
  if (error instanceof BackendUnavailableError) {
    // 409: the workload is valid, but the backend the caller pinned conflicts
    // with the current state of the fleet. The alternatives make this
    // actionable — the caller resubmits with one of the offered targets.
    return NextResponse.json({
      error: {
        type: "backend_unavailable",
        message: error.message,
        requested: {
          backend_id: error.backend.id,
          display_name: error.backend.displayName,
          provider: error.backend.provider,
          reason_code: error.reason.code,
          reason: error.reason.message,
          resolution: resolutionFor(error.backend, error.reason),
        },
        alternatives: error.alternatives,
        retry_with_auto: error.alternatives.length ? { target: "auto" } : undefined,
      },
    }, { status: 409, headers });
  }
  if (error instanceof TranspilerUnavailableError) {
    // Missing config or an unreachable compiler worker is an operational
    // outage, not a bug in the caller's request. It carries an actionable
    // message, so it is forwarded verbatim like the other modelled errors.
    return NextResponse.json(
      { error: { type: "compiler_unavailable", message: error.message } },
      { status: 503, headers: { ...headers, "retry-after": "30" } },
    );
  }
  if (error instanceof Error && error.message.includes("No backend")) {
    return NextResponse.json({ error: { type: "routing_error", message: error.message } }, { status: 422, headers });
  }
  logRedactedError(`v1 unhandled error (request ${id})`, error);
  // Postgres/PostgREST codes and the error class name are schema-level: unlike
  // `details`/`hint` they never quote a customer row (see redactError), and
  // they are the whole difference between a debuggable 500 and an opaque one.
  // Without them the only way to identify the fault is server-log access.
  const source = (error ?? {}) as { code?: unknown; name?: unknown };
  const code = typeof source.code === "string" && source.code ? source.code : undefined;
  const kind = typeof source.name === "string" && source.name && source.name !== "Error" ? source.name : undefined;
  return NextResponse.json(
    { error: { type: "server_error", message: "Internal server error.", request_id: id, ...(code ? { code } : {}), ...(kind ? { kind } : {}) } },
    { status: 500, headers },
  );
}
