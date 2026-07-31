/**
 * Assistant streaming with provider failover.
 *
 * Gemini is preferred because it streams token-by-token and emits visible
 * reasoning. When it is unconfigured, rate-limited, or down (its 503 "high
 * demand" response is common), the console must not go dark — so the request
 * falls back to the OpenAI-compatible providers in `inference.ts`
 * (Vultr Serverless Inference first, then OpenRouter).
 *
 * Failover only happens before the first visible token. Once text has reached
 * the client, restarting on a different provider would duplicate the answer, so
 * a mid-stream failure surfaces instead.
 */

import { createAIChatCompletion, isAIInferenceConfigured } from "./inference";
import { isGeminiConfigured, streamGemini, type GeminiStreamChunk, type GeminiTurn, type GeminiUsage } from "./gemini";

export type AssistantProvider = "gemini" | "inference";

export interface AssistantChunk extends GeminiStreamChunk {
  provider: AssistantProvider;
}

export function isAssistantConfigured() {
  return isGeminiConfigured() || isAIInferenceConfigured();
}

/** Splits text into small pieces so a non-streaming provider still renders progressively. */
function* chunkText(text: string, size = 180): Generator<string> {
  let index = 0;
  while (index < text.length) {
    // Prefer breaking at whitespace so words are not split mid-token.
    let end = Math.min(index + size, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf(" ", end);
      if (boundary > index) end = boundary + 1;
    }
    yield text.slice(index, end);
    index = end;
  }
}

export async function* streamAssistant(options: {
  system: string;
  turns: GeminiTurn[];
  maxOutputTokens?: number;
  signal?: AbortSignal;
  onUsage?: (usage: GeminiUsage) => void;
  /** Called when the primary provider fails and a fallback takes over. */
  onFailover?: (info: { from: AssistantProvider; to: AssistantProvider; reason: string }) => void;
}): AsyncGenerator<AssistantChunk> {
  let emitted = false;

  if (isGeminiConfigured()) {
    try {
      for await (const chunk of streamGemini({
        system: options.system,
        turns: options.turns,
        maxOutputTokens: options.maxOutputTokens,
        signal: options.signal,
        onUsage: options.onUsage,
      })) {
        if (chunk.type === "text" && chunk.text) emitted = true;
        yield { ...chunk, provider: "gemini" };
      }
      return;
    } catch (error) {
      // The user is already reading Gemini's answer; a second provider would
      // restart it from the top, so let the failure surface instead.
      if (emitted) throw error;
      if (options.signal?.aborted) throw error;
      const reason = error instanceof Error ? error.message : "Gemini request failed.";
      if (!isAIInferenceConfigured()) throw error;
      options.onFailover?.({ from: "gemini", to: "inference", reason });
    }
  }

  if (!isAIInferenceConfigured()) {
    throw new Error("No assistant provider is configured.");
  }

  const result = await createAIChatCompletion({
    messages: [
      { role: "system", content: options.system },
      ...options.turns.map((turn) => ({
        role: turn.role === "model" ? ("assistant" as const) : ("user" as const),
        content: turn.text,
      })),
    ],
    maxTokens: options.maxOutputTokens ?? 3_072,
    signal: options.signal,
  });

  if (result.usage) {
    options.onUsage?.({
      promptTokens: result.usage.prompt_tokens,
      outputTokens: result.usage.completion_tokens,
      totalTokens: result.usage.total_tokens,
    });
  }

  for (const piece of chunkText(result.content)) {
    yield { type: "text", text: piece, provider: "inference" };
  }
}
