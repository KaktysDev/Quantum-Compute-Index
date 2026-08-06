// Error logging that keeps customer data out of the platform log.
//
// Supabase surfaces PostgrestError objects whose `details` and `hint` quote the
// offending row back at you. For QRouter that row can be circuit source or job
// results, so those two fields must never reach the log sink. `code` and
// `message` are schema-level and are what an on-call engineer actually needs.

const SAFE_KEYS = ["name", "message", "code"] as const;

/** Field-allowlisted view of an unknown throwable. */
export function redactError(error: unknown): Record<string, unknown> {
  const source = (error ?? {}) as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const key of SAFE_KEYS) {
    const value = source[key];
    if (typeof value === "string" || typeof value === "number") safe[key] = value;
  }
  if (error instanceof Error) safe.stack = error.stack;
  else {
    if (!Object.keys(safe).length) safe.value = typeof error;
    // Postgrest errors are plain objects, so the only way to find the call site
    // is to capture one here.
    safe.stack = new Error("redacted error").stack;
  }
  return safe;
}

export function logRedactedError(context: string, error: unknown): void {
  console.error(context, redactError(error));
}
