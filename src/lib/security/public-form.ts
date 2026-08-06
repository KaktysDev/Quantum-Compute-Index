import { NextResponse } from "next/server";
import { logRedactedError } from "./log";
import { clientAddress, consumeRateLimit } from "./rate-limit";

/** Generous for a human filling in a form, useless for a submission flood. */
export const PUBLIC_FORM_LIMIT = 5;
export const PUBLIC_FORM_WINDOW_SECONDS = 600;

/**
 * Counts one submission from the caller's address against `bucketPrefix`.
 * Returns a ready-made response when the caller must be turned away, or null to
 * carry on. Both public forms are unauthenticated and write with the service
 * role, so a limiter outage fails closed (503) instead of waving traffic through.
 */
export async function guardPublicForm(request: Request, bucketPrefix: string): Promise<NextResponse | null> {
  let decision;
  try {
    decision = await consumeRateLimit(
      `${bucketPrefix}:${clientAddress(request)}`,
      PUBLIC_FORM_LIMIT,
      PUBLIC_FORM_WINDOW_SECONDS,
    );
  } catch (error) {
    logRedactedError(`${bucketPrefix} rate limit check failed`, error);
    return NextResponse.json({ error: "Service temporarily unavailable. Please try again shortly." }, { status: 503 });
  }
  if (decision.allowed) return null;
  return NextResponse.json(
    { error: "Too many submissions. Please try again later." },
    { status: 429, headers: { "retry-after": String(decision.retryAfterSeconds) } },
  );
}
