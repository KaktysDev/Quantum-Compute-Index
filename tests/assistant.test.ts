import { beforeEach, describe, expect, it, vi } from "vitest";

const gemini = vi.hoisted(() => ({
  isGeminiConfigured: vi.fn(() => true),
  streamGemini: vi.fn(),
}));
const inference = vi.hoisted(() => ({
  isAIInferenceConfigured: vi.fn(() => true),
  createAIChatCompletion: vi.fn(),
}));

vi.mock("@/lib/ai/gemini", () => gemini);
vi.mock("@/lib/ai/inference", () => inference);

const { streamAssistant, isAssistantConfigured } = await import("@/lib/ai/assistant");

async function collect(generator: AsyncGenerator<{ type: string; text: string; provider: string }>) {
  const chunks: Array<{ type: string; text: string; provider: string }> = [];
  for await (const chunk of generator) chunks.push(chunk);
  return chunks;
}

const turns = [{ role: "user" as const, text: "run the bell circuit" }];

describe("assistant provider failover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gemini.isGeminiConfigured.mockReturnValue(true);
    inference.isAIInferenceConfigured.mockReturnValue(true);
  });

  it("uses Gemini when it works and never calls the fallback", async () => {
    gemini.streamGemini.mockImplementation(async function* () {
      yield { type: "thought", text: "thinking" };
      yield { type: "text", text: "Bell state ready." };
    });

    const chunks = await collect(streamAssistant({ system: "s", turns }));
    expect(chunks.map((c) => c.text).join("")).toBe("thinkingBell state ready.");
    expect(chunks.every((c) => c.provider === "gemini")).toBe(true);
    expect(inference.createAIChatCompletion).not.toHaveBeenCalled();
  });

  it("falls back to Vultr inference when Gemini returns 503", async () => {
    gemini.streamGemini.mockImplementation(async function* () {
      throw new Error("Gemini request failed (503): high demand");
    });
    inference.createAIChatCompletion.mockResolvedValue({
      content: "Answer from the fallback provider.",
      model: "nvidia/Nemotron-Cascade-2-30B-A3B",
      provider: "vultr",
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    const onFailover = vi.fn();
    const onUsage = vi.fn();

    const chunks = await collect(streamAssistant({ system: "s", turns, onFailover, onUsage }));

    expect(chunks.map((c) => c.text).join("")).toBe("Answer from the fallback provider.");
    expect(chunks.every((c) => c.provider === "inference")).toBe(true);
    expect(onFailover).toHaveBeenCalledWith(expect.objectContaining({ from: "gemini", to: "inference" }));
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ totalTokens: 15 }));
  });

  it("does not restart on a different provider once text has been sent", async () => {
    gemini.streamGemini.mockImplementation(async function* () {
      yield { type: "text", text: "partial answer" };
      throw new Error("connection reset");
    });

    await expect(collect(streamAssistant({ system: "s", turns }))).rejects.toThrow("connection reset");
    expect(inference.createAIChatCompletion).not.toHaveBeenCalled();
  });

  it("uses the fallback directly when Gemini is not configured", async () => {
    gemini.isGeminiConfigured.mockReturnValue(false);
    inference.createAIChatCompletion.mockResolvedValue({
      content: "Vultr only.", model: "m", provider: "vultr",
    });

    const chunks = await collect(streamAssistant({ system: "s", turns }));
    expect(chunks.map((c) => c.text).join("")).toBe("Vultr only.");
    expect(gemini.streamGemini).not.toHaveBeenCalled();
  });

  it("reports configured when either provider is available", () => {
    gemini.isGeminiConfigured.mockReturnValue(false);
    inference.isAIInferenceConfigured.mockReturnValue(false);
    expect(isAssistantConfigured()).toBe(false);
    inference.isAIInferenceConfigured.mockReturnValue(true);
    expect(isAssistantConfigured()).toBe(true);
  });
});
