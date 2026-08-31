/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) — hashing substrate for the envelope
 * and capability fingerprints (§3.4, C2.3, C3.2). Numbers are IEEE-754 doubles
 * rendered with ECMAScript NumberToString; symbolic parameters stay strings.
 */

import { createHash } from "crypto";

export function jcs(value: unknown): string {
  return canonicalize(value);
}

export function jcsHash(value: unknown): string {
  return createHash("sha256").update(jcs(value), "utf8").digest("hex");
}

/** Org-scoped content address — H(organization_id ‖ content). Never cross-tenant (C3.1). */
export function orgContentHash(organizationId: string, content: string): string {
  return createHash("sha256").update(`${organizationId}\n${content}`, "utf8").digest("hex");
}

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("JCS rejects non-finite numbers (I-JSON).");
    if (Object.is(value, -0)) return "0";
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
  }
  throw new Error("JCS cannot canonicalize this value.");
}
