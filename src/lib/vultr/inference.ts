type ChatRole = "system" | "user" | "assistant" | "developer" | "tool";

export interface VultrChatMessage {
  role: ChatRole;
  content: string;
}

interface VultrChatChoice {
  message?: {
    content?: string | null;
    reasoning?: string | null;
  };
}

interface VultrChatResponse {
  model?: string;
  choices?: VultrChatChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface VultrTextResult {
  content: string;
  model: string;
  usage?: VultrChatResponse["usage"];
}

export class VultrInferenceError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "VultrInferenceError";
  }
}

function apiKey() {
  const key = process.env.VULTR_INFERENCE_API_KEY ?? process.env.VULTR_SERVERLESS_INFERENCE_API_KEY ?? "";
  return key.startsWith("your-") ? "" : key;
}

function baseUrl() {
  return (process.env.VULTR_INFERENCE_BASE_URL ?? "https://api.vultrinference.com/v1").replace(/\/+$/, "");
}

function numberFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function timeoutMs() {
  return Math.max(1, numberFromEnv("VULTR_INFERENCE_TIMEOUT", 60)) * 1000;
}

export function isVultrInferenceConfigured() {
  return apiKey().length > 0;
}

export function vultrInferenceDefaults() {
  return {
    mainModel: process.env.VULTR_MAIN_MODEL ?? "nvidia/Nemotron-Cascade-2-30B-A3B",
    fallbackModel: process.env.VULTR_FALLBACK_MODEL,
    toolModel: process.env.VULTR_TOOL_MODEL ?? process.env.VULTR_MAIN_MODEL,
    maxTokens: Math.max(1, Math.round(numberFromEnv("VULTR_MAX_TOKENS", 1200))),
    temperature: Math.min(2, Math.max(0, numberFromEnv("VULTR_TEMPERATURE", 0.2))),
  };
}

async function vultrJson<T>(path: string, init: RequestInit = {}) {
  const token = apiKey();
  if (!token) throw new VultrInferenceError("AI route advisor is not configured.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
      signal: controller.signal,
    });
    const text = await response.text();
    const data = (text ? JSON.parse(text) : {}) as T & { error?: string; detail?: string; message?: string };
    if (!response.ok) {
      const detail = data.detail ?? data.error ?? data.message ?? `AI route advisor request failed (${response.status}).`;
      throw new VultrInferenceError(detail, response.status);
    }
    return data as T;
  } catch (error) {
    if (error instanceof VultrInferenceError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new VultrInferenceError("AI route advisor request timed out.");
    }
    throw new VultrInferenceError(error instanceof Error ? error.message : "AI route advisor request failed.");
  } finally {
    clearTimeout(timer);
  }
}

export async function createVultrChatCompletion(input: {
  messages: VultrChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  collection?: string;
}) {
  const defaults = vultrInferenceDefaults();
  const model = input.model ?? defaults.mainModel;
  const body = {
    model,
    messages: input.messages,
    max_tokens: input.maxTokens ?? defaults.maxTokens,
    temperature: input.temperature ?? defaults.temperature,
    stream: false,
    ...(input.collection ? { collection: input.collection } : {}),
  };
  const response = await vultrJson<VultrChatResponse>(
    input.collection ? "/chat/completions/RAG" : "/chat/completions",
    { method: "POST", body: JSON.stringify(body) },
  );
  const message = response.choices?.[0]?.message;
  const content = (message?.content ?? message?.reasoning ?? "").trim();
  if (!content) throw new VultrInferenceError("AI route advisor returned an empty response.");
  return { content, model: response.model ?? model, usage: response.usage } satisfies VultrTextResult;
}

export async function createVultrChatCompletionWithFallback(input: {
  messages: VultrChatMessage[];
  maxTokens?: number;
  temperature?: number;
  collection?: string;
}) {
  const defaults = vultrInferenceDefaults();
  try {
    return await createVultrChatCompletion({ ...input, model: defaults.mainModel });
  } catch (error) {
    if (!defaults.fallbackModel || defaults.fallbackModel === defaults.mainModel) throw error;
    return createVultrChatCompletion({ ...input, model: defaults.fallbackModel });
  }
}

export async function listVultrModels() {
  return vultrJson<{ data?: Array<{ id: string }>; models?: Array<{ id: string }> }>("/models");
}
