// ─────────────────────────────────────────────────────────────────────────────
// Gemini streaming client (server-side ONLY — the key never leaves the server).
//
// Talks straight to the Generative Language REST API with alt=sse streaming and
// thought summaries enabled (thinkingConfig.includeThoughts), so callers get a
// live "thinking" channel alongside the answer, Claude-style.
// ─────────────────────────────────────────────────────────────────────────────

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-3.5-flash";

export interface GeminiTurn {
  role: "user" | "model";
  text: string;
}

export interface GeminiStreamChunk {
  type: "thought" | "text";
  text: string;
}

export interface GeminiUsage {
  promptTokens?: number;
  outputTokens?: number;
  thoughtTokens?: number;
  totalTokens?: number;
}

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function geminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

/**
 * Stream a Gemini response. Yields thought/text chunks as they arrive; the
 * final usage is delivered through `onUsage` after the stream is drained.
 */
export async function* streamGemini(options: {
  system: string;
  turns: GeminiTurn[];
  maxOutputTokens?: number;
  signal?: AbortSignal;
  onUsage?: (usage: GeminiUsage) => void;
}): AsyncGenerator<GeminiStreamChunk> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not configured.");

  const body = {
    systemInstruction: { parts: [{ text: options.system }] },
    contents: options.turns.map((turn) => ({
      role: turn.role,
      parts: [{ text: turn.text }],
    })),
    generationConfig: {
      thinkingConfig: { includeThoughts: true },
      maxOutputTokens: options.maxOutputTokens ?? 4096,
    },
  };

  const response = await fetch(
    `${GEMINI_BASE}/models/${geminiModel()}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: options.signal,
    },
  );

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Gemini request failed (${response.status}): ${detail.slice(0, 300) || "no detail"}`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let usage: GeminiUsage = {};

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === "[DONE]") continue;
        let parsed: {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
          usageMetadata?: {
            promptTokenCount?: number;
            candidatesTokenCount?: number;
            thoughtsTokenCount?: number;
            totalTokenCount?: number;
          };
        };
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }
        if (parsed.usageMetadata) {
          usage = {
            promptTokens: parsed.usageMetadata.promptTokenCount,
            outputTokens: parsed.usageMetadata.candidatesTokenCount,
            thoughtTokens: parsed.usageMetadata.thoughtsTokenCount,
            totalTokens: parsed.usageMetadata.totalTokenCount,
          };
        }
        for (const part of parsed.candidates?.[0]?.content?.parts ?? []) {
          if (!part.text) continue;
          yield { type: part.thought ? "thought" : "text", text: part.text };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  options.onUsage?.(usage);
}
