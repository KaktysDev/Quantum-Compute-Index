// ──────────────────────────────────────────────────────────────────────────────
// Provider API-key encryption at rest (AES-256-GCM).
//
// Keys pasted in Settings are encrypted with KEY_ENCRYPTION_SECRET before being
// stored in Supabase, and only ever decrypted server-side (cron / key usage).
// The raw key is never returned to the browser. SERVER ONLY.
// ──────────────────────────────────────────────────────────────────────────────

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const secret = process.env.KEY_ENCRYPTION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("KEY_ENCRYPTION_SECRET is missing or too short (min 16 chars).");
  }
  // Derive a stable 32-byte key from the secret.
  return createHash("sha256").update(secret).digest();
}

/** Encrypt plaintext → base64(iv | tag | ciphertext). */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

/** Decrypt base64(iv | tag | ciphertext) → plaintext. */
export function decryptSecret(payload: string): string {
  const key = getKey();
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Mask a key for display, e.g. "sk-12…cd9f". Never sends the real key. */
export function maskKey(plaintext: string): string {
  if (plaintext.length <= 8) return "••••";
  return `${plaintext.slice(0, 4)}…${plaintext.slice(-4)}`;
}
