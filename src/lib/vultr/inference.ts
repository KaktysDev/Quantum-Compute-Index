import {
  AIInferenceError,
  createProviderChatCompletion,
  inferenceDefaults,
  isAIProviderConfigured,
  listAIModels,
  type AIChatCompletionInput,
  type AIChatMessage,
  type AITextResult,
} from "@/lib/ai/inference";

// Backwards-compatible Vultr exports for callers outside the Route Advisor.
export { AIInferenceError as VultrInferenceError };
export type VultrChatMessage = AIChatMessage;
export type VultrTextResult = AITextResult;

export function isVultrInferenceConfigured() {
  return isAIProviderConfigured("vultr");
}

export function vultrInferenceDefaults() {
  const defaults = inferenceDefaults("vultr");
  return {
    mainModel: defaults.mainModel,
    fallbackModel: defaults.fallbackModel,
    toolModel: process.env.VULTR_TOOL_MODEL ?? defaults.mainModel,
    maxTokens: defaults.maxTokens,
    temperature: defaults.temperature,
  };
}

export function createVultrChatCompletion(input: AIChatCompletionInput) {
  return createProviderChatCompletion("vultr", input);
}

export async function createVultrChatCompletionWithFallback(input: Omit<AIChatCompletionInput, "model">) {
  const defaults = inferenceDefaults("vultr");
  try {
    return await createProviderChatCompletion("vultr", { ...input, model: defaults.mainModel });
  } catch (error) {
    if (!defaults.fallbackModel || defaults.fallbackModel === defaults.mainModel) throw error;
    return createProviderChatCompletion("vultr", { ...input, model: defaults.fallbackModel });
  }
}

export function listVultrModels() {
  return listAIModels("vultr");
}
