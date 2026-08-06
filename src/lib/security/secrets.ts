import { createHash, timingSafeEqual } from "crypto";

/**
 * Constant-time string comparison. Both sides are hashed first so the buffers
 * handed to `timingSafeEqual` are always 32 bytes: it cannot throw on a length
 * mismatch, and the comparison itself leaks nothing about the secret's length.
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(a), digest(b));
}

/**
 * Shared bearer check for the cron/internal endpoints. Fails closed when
 * CRON_SECRET is unset or empty, so a misconfigured deploy locks the schedulers
 * out rather than opening the routes to the internet.
 */
export function authorizeCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) return false;
  return timingSafeEqualStrings(request.headers.get("authorization") ?? "", `Bearer ${secret}`);
}
