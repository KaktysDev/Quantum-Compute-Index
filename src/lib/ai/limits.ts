// ─────────────────────────────────────────────────────────────────────────────
// Assistant usage quotas — protects the Gemini key from abuse.
//
// Every org gets a fixed budget of messages AND streamed tokens per window
// (default: 40 messages / 250k tokens per 3 hours; override via env). The
// source of truth is the assistant_usage table (see supabase/chat.sql); when
// the migration hasn't run, or the principal is demo, an in-memory window
// applies so the cap still holds per server instance.
// ─────────────────────────────────────────────────────────────────────────────

import type { Principal } from "@/lib/qrouter/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const WINDOW_SECONDS = Math.max(1, Number(process.env.ASSISTANT_WINDOW_HOURS ?? 3)) * 3600;
const MESSAGE_LIMIT = Math.max(1, Number(process.env.ASSISTANT_MESSAGE_LIMIT ?? 40));
const TOKEN_LIMIT = Math.max(1_000, Number(process.env.ASSISTANT_TOKEN_LIMIT ?? 250_000));

export interface QuotaResult {
  allowed: boolean;
  /** Minutes until the current window resets (for the 429 message). */
  resetMinutes: number;
  reason?: "messages" | "tokens";
}

interface MemoryWindow {
  start: number;
  messages: number;
  tokens: number;
}

const memory = new Map<string, MemoryWindow>();

function windowStart(nowMs: number): number {
  return Math.floor(nowMs / 1000 / WINDOW_SECONDS) * WINDOW_SECONDS * 1000;
}

function resetMinutes(startMs: number): number {
  return Math.max(1, Math.ceil((startMs + WINDOW_SECONDS * 1000 - Date.now()) / 60_000));
}

function consumeMemory(key: string): QuotaResult {
  const start = windowStart(Date.now());
  let win = memory.get(key);
  if (!win || win.start !== start) {
    win = { start, messages: 0, tokens: 0 };
    memory.set(key, win);
  }
  win.messages += 1;
  if (memory.size > 5_000) memory.clear(); // unbounded-growth guard
  if (win.messages > MESSAGE_LIMIT) return { allowed: false, resetMinutes: resetMinutes(start), reason: "messages" };
  if (win.tokens >= TOKEN_LIMIT) return { allowed: false, resetMinutes: resetMinutes(start), reason: "tokens" };
  return { allowed: true, resetMinutes: resetMinutes(start) };
}

/** Count one assistant message; returns whether the org is within budget. */
export async function consumeAssistantQuota(principal: Principal): Promise<QuotaResult> {
  if (principal.demo) return consumeMemory(`demo:${principal.organizationId}`);
  try {
    const { data, error } = await createAdminClient().rpc("consume_assistant_quota", {
      p_org: principal.organizationId,
      p_msg_limit: MESSAGE_LIMIT,
      p_token_limit: TOKEN_LIMIT,
      p_window_seconds: WINDOW_SECONDS,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("empty quota response");
    const reset = Math.max(1, Math.ceil((new Date(row.reset_at).getTime() - Date.now()) / 60_000));
    if (row.allowed) return { allowed: true, resetMinutes: reset };
    return {
      allowed: false,
      resetMinutes: reset,
      reason: Number(row.tokens) >= TOKEN_LIMIT ? "tokens" : "messages",
    };
  } catch {
    // Migration missing / transient DB issue → per-instance memory window.
    return consumeMemory(`org:${principal.organizationId}`);
  }
}

/** Record the streamed token total once a turn finishes (best-effort). */
export async function recordAssistantTokens(principal: Principal, tokens: number): Promise<void> {
  if (!Number.isFinite(tokens) || tokens <= 0) return;
  const key = principal.demo ? `demo:${principal.organizationId}` : `org:${principal.organizationId}`;
  const win = memory.get(key);
  if (win && win.start === windowStart(Date.now())) win.tokens += tokens;
  if (principal.demo) return;
  try {
    await createAdminClient().rpc("record_assistant_tokens", {
      p_org: principal.organizationId,
      p_tokens: Math.round(tokens),
      p_window_seconds: WINDOW_SECONDS,
    });
  } catch {
    /* memory fallback above already counted it */
  }
}

export function quotaLimits() {
  return { messages: MESSAGE_LIMIT, tokens: TOKEN_LIMIT, windowHours: WINDOW_SECONDS / 3600 };
}
