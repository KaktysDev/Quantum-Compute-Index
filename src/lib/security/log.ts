// Error logging that keeps customer data out of the platform log.
//
// Supabase surfaces PostgrestError objects whose `details` and `hint` quote the
// offending row back at you. For QRouter that row can be circuit source or job
// results, so those two fields must never reach the log sink. `code` and
// `message` are schema-level and are what an on-call engineer actually needs.

const SAFE_KEYS = ["name", "message", "code"] as const;

/**
 * Strips credential material from a customer- or log-facing string.
 * Environment *names* (IBM_QUANTUM_TOKEN) stay; values, Bearer tokens,
 * Authorization headers, and issued API keys do not.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._\-/=+]+/gi, "Bearer [redacted]")
    .replace(/\bapiKey\s+\S+/gi, "apiKey [redacted]")
    .replace(/\bAuthorization:\s*[^\r\n]+/gi, "Authorization: [redacted]")
    .replace(
      /\b(IBM_QUANTUM_TOKEN|IONQ_API_KEY|QI_API_KEY|AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|QROUTER_COMPILER_TOKEN|VULTR_SIMULATOR_TOKEN|XANADU_API_KEY|QUANDELA_API_KEY|CRON_SECRET)\s*[=:]\s*\S+/gi,
      "$1=[redacted]",
    )
    .replace(/\bwhsec_[A-Za-z0-9_-]+/g, "whsec_[redacted]")
    .replace(/\bqci_(?:live|test)_[A-Za-z0-9_-]{8,}/g, "qci_[redacted]");
}

/** Field-allowlisted view of an unknown throwable. */
export function redactError(error: unknown): Record<string, unknown> {
  const source = (error ?? {}) as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const key of SAFE_KEYS) {
    const value = source[key];
    if (typeof value === "string") safe[key] = key === "message" ? redactSecrets(value) : value;
    else if (typeof value === "number") safe[key] = value;
  }
  if (error instanceof Error) {
    if (error.stack) safe.stack = redactSecrets(error.stack);
  } else {
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
