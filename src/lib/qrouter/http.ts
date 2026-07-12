import { NextResponse } from "next/server";
import { AuthenticationError } from "./auth";
import { CircuitValidationError } from "./analyze";

export function apiError(error: unknown) {
  if (error instanceof AuthenticationError) {
    return NextResponse.json({ error: { type: "authentication_error", message: error.message } }, { status: 401 });
  }
  if (error instanceof CircuitValidationError) {
    return NextResponse.json({ error: { type: "invalid_circuit", message: error.message, details: error.details } }, { status: 422 });
  }
  if (error instanceof Error && error.message.includes("No backend")) {
    return NextResponse.json({ error: { type: "routing_error", message: error.message } }, { status: 422 });
  }
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  console.error(error);
  return NextResponse.json({ error: { type: "server_error", message } }, { status: 500 });
}

