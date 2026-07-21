export type AIProvider = "vultr" | "openrouter";
export type ChatRole = "system" | "user" | "assistant" | "developer" | "tool";

export interface AIChatMessage {
  role: ChatRole;
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface OpenRouterProviderPreferences {
  order?: string[];
  only?: string[];
  ignore?: string[];
  allow_fallbacks?: boolean;
  require_parameters?: boolean;
  data_collection?: "allow" | "deny";
  sort?: "price" | "throughput" | "latency";
}

export interface AIChatCompletionInput {
  messages: AIChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  collection?: string;
  provider?: OpenRouterProviderPreferences;
  responseFormat?: { type: "json_object" } | { type: "json_schema"; json_schema: Record<string, unknown> };
  signal?: AbortSignal;
}

interface ChatChoice {
  message?: {
    content?: string | Array<{ type?: string; text?: string }> | null;
    reasoning?: string | null;
  };
}

export interface AIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
  is_byok?: boolean;
}

interface ChatResponse {
  id?: string;
  model?: string;
  provider?: string;
  choices?: ChatChoice[];
  usage?: AIUsage;
}

interface ErrorResponse {
  error?: string | { message?: string; code?: string | number; metadata?: Record<string, unknown> };
  detail?: string | { message?: string };
  message?: string;
}

export interface AITextResult {
  content: string;
  model: string;
  provider: AIProvider;
  upstreamProvider?: string;
  usage?: AIUsage;
}

export class AIInferenceError extends Error {
  constructor(
    message: string,
    public readonly provider?: AIProvider,
    public readonly status?: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "AIInferenceError";
  }
}

interface ProviderConfig {
  provider: AIProvider;
  apiKey: string;
  baseUrl: string;
  mainModel: string;
  fallbackModel?: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
}

const PROVIDERS: AIProvider[] = ["vultr", "openrouter"];

function usableSecret(value: string | undefined) {
  const secret = value?.trim() ?? "";
  return secret.startsWith("your-") ? "" : secret;
}

function numberFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function booleanFromEnv(name: string, fallback: boolean) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return !["0", "false", "no", "off"].includes(value);
}

function csvFromEnv(name: string) {
  return process.env[name]?.split(",").map((value) => value.trim()).filter(Boolean);
}

export function inferenceDefaults(provider: AIProvider): ProviderConfig {
  if (provider === "openrouter") {
    return {
      provider,
      apiKey: usableSecret(process.env.OPENROUTER_API_KEY),
      baseUrl: (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/+$/, ""),
      mainModel: process.env.OPENROUTER_MAIN_MODEL?.trim() || "openrouter/auto",
      fallbackModel: process.env.OPENROUTER_FALLBACK_MODEL?.trim() || undefined,
      maxTokens: Math.max(1, Math.round(numberFromEnv("OPENROUTER_MAX_TOKENS", 1200))),
      temperature: Math.min(2, Math.max(0, numberFromEnv("OPENROUTER_TEMPERATURE", 0.2))),
      timeoutMs: Math.max(1, numberFromEnv("OPENROUTER_TIMEOUT", 60)) * 1000,
    };
  }

  return {
    provider,
    apiKey: usableSecret(process.env.VULTR_INFERENCE_API_KEY ?? process.env.VULTR_SERVERLESS_INFERENCE_API_KEY),
    baseUrl: (process.env.VULTR_INFERENCE_BASE_URL ?? "https://api.vultrinference.com/v1").replace(/\/+$/, ""),
    mainModel: process.env.VULTR_MAIN_MODEL?.trim() || "nvidia/Nemotron-Cascade-2-30B-A3B",
    fallbackModel: process.env.VULTR_FALLBACK_MODEL?.trim() || undefined,
    maxTokens: Math.max(1, Math.round(numberFromEnv("VULTR_MAX_TOKENS", 1200))),
    temperature: Math.min(2, Math.max(0, numberFromEnv("VULTR_TEMPERATURE", 0.2))),
    timeoutMs: Math.max(1, numberFromEnv("VULTR_INFERENCE_TIMEOUT", 60)) * 1000,
  };
}

export function isAIProviderConfigured(provider: AIProvider) {
  return inferenceDefaults(provider).apiKey.length > 0;
}

export function configuredAIProviders() {
  const requested = (csvFromEnv("AI_PROVIDER_ORDER") ?? PROVIDERS)
    .filter((provider): provider is AIProvider => PROVIDERS.includes(provider as AIProvider));
  const ordered = [...new Set([...requested, ...PROVIDERS])];
  return ordered.filter(isAIProviderConfigured);
}

export function isAIInferenceConfigured() {
  return configuredAIProviders().length > 0;
}

function errorDetail(data: ErrorResponse, status: number) {
  const candidates = [data.error, data.detail, data.message];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    if (candidate && typeof candidate === "object" && typeof candidate.message === "string") return candidate.message;
  }
  return `AI provider request failed (${status}).`;
}

function errorCode(data: ErrorResponse) {
  const code = data.error && typeof data.error === "object" ? data.error.code : undefined;
  return code === undefined ? undefined : String(code);
}

function parseJson(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 300) };
  }
}

function openRouterHeaders() {
  const siteUrl = process.env.OPENROUTER_SITE_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const title = process.env.OPENROUTER_APP_NAME?.trim() || "QRouter";
  return {
    ...(siteUrl ? { "HTTP-Referer": siteUrl } : {}),
    "X-OpenRouter-Title": title,
  };
}

function openRouterPreferences(input?: OpenRouterProviderPreferences) {
  const envOrder = csvFromEnv("OPENROUTER_PROVIDER_ORDER");
  const dataCollection = process.env.OPENROUTER_DATA_COLLECTION?.trim().toLowerCase();
  const fromEnv: OpenRouterProviderPreferences = {
    ...(envOrder?.length ? { order: envOrder } : {}),
    allow_fallbacks: booleanFromEnv("OPENROUTER_ALLOW_FALLBACKS", true),
    ...(dataCollection === "allow" || dataCollection === "deny" ? { data_collection: dataCollection } : {}),
  };
  const preferences = { ...fromEnv, ...input };
  return Object.keys(preferences).length ? preferences : undefined;
}

async function providerJson<T>(config: ProviderConfig, path: string, init: RequestInit) {
  if (!config.apiKey) throw new AIInferenceError(`${config.provider} inference is not configured.`, config.provider, undefined, "not_configured");

  const controller = new AbortController();
  const abort = () => controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${config.apiKey}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(config.provider === "openrouter" ? openRouterHeaders() : {}),
        ...init.headers,
      },
      signal: controller.signal,
    });
    const data = parseJson(await response.text());
    if (!response.ok) {
      const error = data as ErrorResponse;
      throw new AIInferenceError(errorDetail(error, response.status), config.provider, response.status, errorCode(error));
    }
    return data as T;
  } catch (error) {
    if (error instanceof AIInferenceError) throw error;
    if (controller.signal.aborted) {
      throw new AIInferenceError(`${config.provider} inference request timed out.`, config.provider, 504, "timeout");
    }
    throw new AIInferenceError(error instanceof Error ? error.message : "AI provider request failed.", config.provider);
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
  }
}

function messageText(message: ChatChoice["message"]) {
  if (typeof message?.content === "string") return message.content.trim();
  if (Array.isArray(message?.content)) {
    return message.content.map((part) => part.text ?? "").join("").trim();
  }
  return message?.reasoning?.trim() ?? "";
}

export async function createProviderChatCompletion(provider: AIProvider, input: AIChatCompletionInput) {
  const config = inferenceDefaults(provider);
  if (input.collection && provider !== "vultr") {
    throw new AIInferenceError("OpenRouter does not support Vultr collection RAG requests.", provider, 400, "unsupported_feature");
  }

  const model = input.model ?? config.mainModel;
  const body = {
    model,
    messages: input.messages,
    max_tokens: input.maxTokens ?? config.maxTokens,
    temperature: input.temperature ?? config.temperature,
    stream: false,
    ...(input.responseFormat ? { response_format: input.responseFormat } : {}),
    ...(input.collection ? { collection: input.collection } : {}),
    ...(provider === "openrouter" ? { provider: openRouterPreferences(input.provider), usage: { include: true } } : {}),
  };
  const response = await providerJson<ChatResponse>(
    config,
    input.collection ? "/chat/completions/RAG" : "/chat/completions",
    { method: "POST", body: JSON.stringify(body), signal: input.signal },
  );
  const content = messageText(response.choices?.[0]?.message);
  if (!content) throw new AIInferenceError("AI provider returned an empty response.", provider, 502, "empty_response");
  return {
    content,
    model: response.model ?? model,
    provider,
    upstreamProvider: response.provider,
    usage: response.usage,
  } satisfies AITextResult;
}

function providerModels(provider: AIProvider, explicitModel?: string) {
  if (explicitModel) return [explicitModel];
  const defaults = inferenceDefaults(provider);
  return [...new Set([defaults.mainModel, defaults.fallbackModel].filter((model): model is string => Boolean(model)))];
}

export async function createAIChatCompletion(input: AIChatCompletionInput) {
  const providers = configuredAIProviders().filter((provider) => !input.collection || provider === "vultr");
  if (!providers.length) throw new AIInferenceError("AI route advisor is not configured.", undefined, 503, "not_configured");

  let lastError: AIInferenceError | undefined;
  for (const provider of providers) {
    for (const model of providerModels(provider, input.model)) {
      try {
        return await createProviderChatCompletion(provider, { ...input, model });
      } catch (error) {
        lastError = error instanceof AIInferenceError
          ? error
          : new AIInferenceError(error instanceof Error ? error.message : "AI provider request failed.", provider);
      }
    }
  }
  throw lastError ?? new AIInferenceError("Every configured AI provider failed.", undefined, 502, "providers_exhausted");
}

export async function listAIModels(provider: AIProvider) {
  const config = inferenceDefaults(provider);
  const response = await providerJson<{ data?: Array<{ id: string }>; models?: Array<{ id: string }> }>(config, "/models", { method: "GET" });
  return response.data ?? response.models ?? [];
}
