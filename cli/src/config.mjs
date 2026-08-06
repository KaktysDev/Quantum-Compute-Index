// Where the API key lives between sessions.
//
// The key is a bearer credential for a billed account, so it is written to a
// 0600 file inside a 0700 directory and never echoed back in full. An env var
// (QROUTER_API_KEY) always wins and is never persisted — that is the shape CI
// and shared machines should use.

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export const DEFAULT_BASE_URL = "https://qrouter.app";

export function configDir() {
  if (process.env.QROUTER_CONFIG_DIR) return path.resolve(process.env.QROUTER_CONFIG_DIR);
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "qrouter");
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  return path.join(xdg && xdg.trim() ? xdg : path.join(os.homedir(), ".config"), "qrouter");
}

export function configPath() {
  return path.join(configDir(), "config.json");
}

export function readConfig() {
  try {
    const raw = readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeConfig(patch) {
  const dir = configDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const next = { ...readConfig(), ...patch, updatedAt: new Date().toISOString() };
  const file = configPath();
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  try {
    // writeFileSync only applies `mode` when creating the file, so an existing
    // file keeps whatever permissions it had.
    chmodSync(file, 0o600);
  } catch {
    /* non-POSIX filesystems */
  }
  return next;
}

export function clearStoredKey() {
  const file = configPath();
  if (!existsSync(file)) return false;
  const next = readConfig();
  delete next.apiKey;
  if (Object.keys(next).filter((key) => key !== "updatedAt").length === 0) {
    rmSync(file, { force: true });
    return true;
  }
  writeConfig(next);
  return true;
}

/**
 * Resolves the key to use, in precedence order.
 * @returns {{ key: string|null, source: "flag"|"env"|"file"|null }}
 */
export function resolveApiKey({ flagKey } = {}) {
  if (flagKey) return { key: flagKey.trim(), source: "flag" };
  const fromEnv = process.env.QROUTER_API_KEY?.trim();
  if (fromEnv) return { key: fromEnv, source: "env" };
  const stored = readConfig().apiKey;
  if (typeof stored === "string" && stored.trim()) return { key: stored.trim(), source: "file" };
  return { key: null, source: null };
}

export function resolveBaseUrl({ flagBaseUrl } = {}) {
  const candidate = flagBaseUrl || process.env.QROUTER_BASE_URL || readConfig().baseUrl || DEFAULT_BASE_URL;
  return String(candidate).replace(/\/+$/, "");
}

/** `qci_live_abcd…` — enough to identify a key, never enough to use one. */
export function maskKey(key) {
  if (!key) return "none";
  const prefix = key.slice(0, 13);
  return `${prefix}${"•".repeat(6)}`;
}

const KEY_PATTERN = /^qci_(live|test)_[A-Za-z0-9_-]{8,}$/;

export function looksLikeApiKey(value) {
  return KEY_PATTERN.test(String(value ?? "").trim());
}
