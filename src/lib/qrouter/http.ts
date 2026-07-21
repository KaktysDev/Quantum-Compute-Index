import { NextResponse } from "next/server";
import { AIInferenceError } from "@/lib/ai/inference";
import { AuthenticationError } from "./auth";
import { CircuitValidationError } from "./analyze";
import { RepositorySourceError } from "./repositories";

export function apiError(error: unknown) {
  if (error instanceof AuthenticationError) {
    return NextResponse.json({ error: { type: "authentication_error", message: error.message } }, { status: 401 });
  }
  if (error instanceof CircuitValidationError) {
    return NextResponse.json({ error: { type: "invalid_circuit", message: error.message, details: error.details } }, { status: 422 });
  }
  if (error instanceof RepositorySourceError) {
    return NextResponse.json({ error: { type: error.type, message: error.message } }, { status: error.status });
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
    }, { status });
  }
  if (error instanceof Error && error.message.includes("No backend")) {
    return NextResponse.json({ error: { type: "routing_error", message: error.message } }, { status: 422 });
  }
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  console.error(error);
  return NextResponse.json({ error: { type: "server_error", message } }, { status: 500 });
}
