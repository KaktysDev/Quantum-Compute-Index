// Shared fixed-window rate limiter.
//
// Counting lives in Postgres (`public.consume_rate_limit`) so the ceiling holds
// across serverless instances. The SQL function ships in supabase/qrouter.sql;
// until that migration is applied the RPC is missing, and rather than fail open
// we fall back to a per-instance counter. The fallback is weaker (one bucket per
// lambda) but never grants an unlimited budget.

import { createAdminClient } from "@/lib/supabase/admin";

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

type Window = { start: number; count: number };

const localWindows = new Map<string, Window>();
const LOCAL_WINDOW_CAP = 10_000;

/** Re-probing a missing RPC on every request would double the round trips. */
let rpcMissingUntil = 0;
const RPC_MISSING_BACKOFF_MS = 5 * 60_000;

function retryAfter(windowSeconds: number) {
  const elapsed = Math.floor((Date.now() / 1000) % windowSeconds);
  return Math.max(1, windowSeconds - elapsed);
}

function consumeLocally(bucket: string, limit: number, windowSeconds: number): RateLimitDecision {
  const windowMs = windowSeconds * 1000;
  const start = Math.floor(Date.now() / windowMs) * windowMs;
  const existing = localWindows.get(bucket);
  const window = existing && existing.start === start ? existing : { start, count: 0 };
  window.count += 1;
  localWindows.set(bucket, window);
  if (localWindows.size > LOCAL_WINDOW_CAP) {
    for (const [key, value] of localWindows) {
      if (value.start < start) localWindows.delete(key);
    }
  }
  return { allowed: window.count <= limit, retryAfterSeconds: retryAfter(windowSeconds) };
}

function isMissingFunction(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  // PGRST202: PostgREST could not find the function in its schema cache.
  return error.code === "PGRST202" || error.code === "42883" || /Could not find the function/i.test(error.message ?? "");
}

/**
 * Counts one request against `bucket`. Throws if the datastore errors for any
 * reason other than the function being absent, so callers fail closed.
 */
export async function consumeRateLimit(bucket: string, limit: number, windowSeconds = 60): Promise<RateLimitDecision> {
  if (limit <= 0) return { allowed: true, retryAfterSeconds: 0 };
  if (Date.now() < rpcMissingUntil) return consumeLocally(bucket, limit, windowSeconds);

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return consumeLocally(bucket, limit, windowSeconds);
  }

  const { data, error } = await admin.rpc("consume_rate_limit", {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    if (!isMissingFunction(error)) throw error;
    rpcMissingUntil = Date.now() + RPC_MISSING_BACKOFF_MS;
    console.warn("consume_rate_limit RPC is missing; falling back to per-instance rate limiting. Apply supabase/qrouter.sql.");
    return consumeLocally(bucket, limit, windowSeconds);
  }
  return { allowed: data !== false, retryAfterSeconds: retryAfter(windowSeconds) };
}

/** Test seam: drops in-process counters and the missing-RPC backoff. */
export function resetRateLimitState() {
  localWindows.clear();
  rpcMissingUntil = 0;
}

/**
 * Best-effort client address. Vercel overwrites `x-forwarded-for` at the edge so
 * the left-most hop is trustworthy there; behind another proxy it is not, which
 * is why this only ever feeds rate limiting and never authorization.
 */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first.slice(0, 64);
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  return "unknown";
}
