import { NextResponse } from "next/server";
import { z } from "zod";
import { generateGeminiText, isGeminiConfigured } from "@/lib/ai/gemini";
import { createAIChatCompletion, isAIInferenceConfigured } from "@/lib/ai/inference";
import { analyzeCircuit } from "@/lib/qrouter/analyze";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { apiError } from "@/lib/qrouter/http";
import { prepareExecution } from "@/lib/qrouter/pipeline";
import { routeCircuit } from "@/lib/qrouter/route";
import { loadRoutingContext } from "@/lib/qrouter/routingContext";
import { publicTranspilation } from "@/lib/qrouter/transpiler";
import { createJobSchema } from "@/lib/qrouter/validation";

export const dynamic = "force-dynamic";

const adviceSchema = createJobSchema.extend({
  question: z.string().trim().max(600).optional(),
});

function publicCandidates(decision: ReturnType<typeof routeCircuit>) {
  return decision.candidates.slice(0, 6).map((candidate) => ({
    backend: {
      id: candidate.backend.id,
      displayName: candidate.backend.displayName,
      provider: candidate.backend.provider,
      kind: candidate.backend.kind,
      queueSeconds: candidate.backend.queueSeconds,
      fidelity: candidate.backend.fidelity,
      reliability: candidate.backend.reliability,
    },
    compatible: candidate.compatible,
    rejectionReasons: candidate.rejectionReasons,
    score: candidate.score,
    estimatedProviderCost: candidate.estimatedProviderCost,
    estimatedNqh: candidate.estimatedNqh,
  }));
}

function deterministicAdvice(
  decision: Awaited<ReturnType<typeof prepareExecution>>["decision"],
  quote: Awaited<ReturnType<typeof prepareExecution>>["quote"],
) {
  return [
    `- Recommended ${decision.selected.displayName} using the ${decision.mode} policy.`,
    `- Estimated total: $${quote.total.toFixed(6)}; provider execution: $${quote.providerCost.toFixed(6)}.`,
    `- ${decision.explanation.join(" ")}`,
  ].join("\n");
}

async function explainRoute(prompt: unknown, fallback: string, signal: AbortSignal) {
  const system = [
    "You are the QRouter route advisor.",
    "The QCI Engine has already selected the quantum backend and computed the quote.",
    "Use only the supplied JSON, never change the selected backend or invent prices.",
    "Keep the response under 180 words with short bullets and label sample QCI data clearly.",
  ].join(" ");
  const warnings: string[] = [];

  if (isGeminiConfigured()) {
    try {
      const result = await generateGeminiText({
        system,
        turns: [{ role: "user", text: JSON.stringify(prompt) }],
        maxOutputTokens: 1_200,
        signal,
      });
      return { advice: result.content, model: result.model, provider: "gemini", usage: result.usage, warnings };
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "Gemini commentary failed.");
    }
  }

  if (isAIInferenceConfigured()) {
    try {
      const result = await createAIChatCompletion({
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(prompt) },
        ],
        signal,
      });
      return {
        advice: result.content,
        model: result.model,
        provider: result.provider,
        upstreamProvider: result.upstreamProvider,
        usage: result.usage,
        warnings,
      };
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "Optional AI commentary failed.");
    }
  }

  return { advice: fallback, model: "qci-engine", provider: "qci-engine", usage: undefined, warnings };
}

export async function POST(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    const parsed = adviceSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: { type: "invalid_request", message: "The request body is invalid.", details: parsed.error.flatten() } }, { status: 400 });
    }
    const input = parsed.data;
    const analysis = analyzeCircuit(input.circuit, input.format);
    const { snapshot, backends } = await loadRoutingContext(principal.demo);
    const prepared = await prepareExecution({
      backends,
      analysis,
      shots: input.shots,
      target: input.target,
      mode: input.routing_mode,
      constraints: input.constraints,
      qciSnapshotId: snapshot.id,
      qciTimestamp: snapshot.ts,
      optimizationLevel: input.optimization_level,
    });
    const { decision, quote } = prepared;
    const candidates = publicCandidates(decision);

    const prompt = {
      analysis: {
        qubits: analysis.qubits,
        classicalBits: analysis.classicalBits,
        depth: analysis.depth,
        gates: analysis.gates,
        twoQubitGates: analysis.twoQubitGates,
        complexity: analysis.complexity,
        gateCounts: analysis.gateCounts,
      },
      routing: {
        selected: decision.selected.id,
        mode: decision.mode,
        explanation: decision.explanation,
        candidates,
      },
      quote,
      qci: {
        snapshotId: snapshot.id,
        timestamp: snapshot.ts,
        source: snapshot.source,
        pricePerQcHour: snapshot.vwap,
      },
      transpilation: publicTranspilation(prepared.transpilation),
      question: input.question ?? "Explain the selected route, the main tradeoff, and one practical optimization to try next.",
    };

    const commentary = await explainRoute(prompt, deterministicAdvice(decision, quote), request.signal);

    return NextResponse.json({
      advice: commentary.advice,
      advice_source: commentary.provider,
      model: commentary.model,
      inference_provider: commentary.provider,
      upstream_provider: commentary.upstreamProvider,
      usage: commentary.usage,
      commentary_warnings: commentary.warnings.length ? commentary.warnings : undefined,
      qci: prompt.qci,
      transpilation: prompt.transpilation,
      analysis: prompt.analysis,
      decision: {
        selected: {
          id: decision.selected.id,
          displayName: decision.selected.displayName,
          provider: decision.selected.provider,
          kind: decision.selected.kind,
        },
        explanation: decision.explanation,
        candidates,
      },
      quote,
    });
  } catch (error) {
    return apiError(error);
  }
}
