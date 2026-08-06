import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { AIInferenceError } from "@/lib/ai/inference";
import { logRedactedError } from "@/lib/security/log";
import { AuthenticationError, RateLimitError } from "./auth";
import { CircuitValidationError } from "./analyze";
import { RepositorySourceError } from "./repositories";

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
  if (error instanceof Error && error.message.includes("No backend")) {
    return NextResponse.json({ error: { type: "routing_error", message: error.message } }, { status: 422, headers });
  }
  logRedactedError(`v1 unhandled error (request ${id})`, error);
  return NextResponse.json(
    { error: { type: "server_error", message: "Internal server error.", request_id: id } },
    { status: 500, headers },
  );
}
