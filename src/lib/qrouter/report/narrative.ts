/**
 * Results-report narrative. Reuses the platform Gemini / inference stack.
 * The model only receives the slim report context — never QASM or raw provider blobs.
 */

import { generateGeminiText, isGeminiConfigured } from "@/lib/ai/gemini";
import { createAIChatCompletion, isAIInferenceConfigured } from "@/lib/ai/inference";
import { getCachedNarrative, setCachedNarrative } from "./cache";
import { aiPayloadFrom } from "./context";
import type { JobReportContext, ReportNarrative } from "./types";

export const REPORT_SYSTEM_PROMPT = [
  "You are the QRouter results narrator.",
  "Write a concise researcher brief (120–220 words) about ONE completed or pending quantum job.",
  "Use only the supplied JSON. Do not invent counts, probabilities, backends, shots, fidelity, circuits, or timestamps.",
  "If a field is null or missing, say it is not in the stored result — never guess.",
  "Cite the most frequent bitstrings and any entropy / shot-integrity notes that are present.",
  "Do not mention encoding-layer internals, QASM, payloads, API keys, or provider raw dumps.",
  "Plain prose. No markdown headings. No bullet walls unless the JSON has three or more concrete findings.",
].join(" ");

export function deterministicNarrative(context: JobReportContext): string {
  const { job, analytics, transpile } = context;
  if (!analytics.available) {
    if (job.status === "failed") return `This QRouter job did not finish with measurement results. Status is ${job.status.replaceAll("_", " ")}.`;
    if (job.status === "cancelled") return "This QRouter job was cancelled before results were stored.";
    return analytics.reason ?? "This QRouter job has no measurement results yet.";
  }
  const parts: string[] = [];
  const shots = analytics.shotsObserved ?? analytics.shotsRequested;
  parts.push(
    `QRouter recorded${shots != null ? ` ${shots.toLocaleString()} shots` : ""} on ${job.backendName}${job.backendKind ? ` (${job.backendKind})` : ""}.`,
  );
  if (analytics.mostProbable) {
    const head = analytics.top[0];
    const pct = head?.probability != null ? ` (${(head.probability * 100).toFixed(2)}%)` : "";
    const count = head?.count != null ? ` with ${head.count.toLocaleString()} shots` : "";
    parts.push(`The most frequent bitstring was |${analytics.mostProbable}⟩${count}${pct}.`);
  }
  if (analytics.distinctStates > 1) {
    parts.push(`${analytics.distinctStates.toLocaleString()} distinct bitstrings appear in the stored histogram.`);
  }
  if (analytics.shannonEntropyBits != null) {
    parts.push(`Shannon entropy of the shot histogram is ${analytics.shannonEntropyBits.toFixed(3)} bits.`);
  } else if (analytics.probabilityEntropyBits != null) {
    parts.push(`Entropy of the stored probability distribution is ${analytics.probabilityEntropyBits.toFixed(3)} bits. Shot-histogram entropy is not available.`);
  }
  if (analytics.fidelity != null) parts.push(`Stored result metadata includes fidelity ${analytics.fidelity}.`);
  if (analytics.stderr != null) parts.push(`Stored result metadata includes stderr ${analytics.stderr}.`);
  if (transpile?.depthFrom != null && transpile.depthTo != null) {
    parts.push(`Compiled depth moved from ${transpile.depthFrom} to ${transpile.depthTo}.`);
  }
  if (analytics.notes.length) parts.push(analytics.notes.join(" "));
  if (job.cost != null) parts.push(`Settled quote for this job is $${job.cost.toFixed(4)}.`);
  return parts.join(" ");
}

export async function generateReportNarrative(
  context: JobReportContext,
  cacheKey: string,
  signal?: AbortSignal,
): Promise<ReportNarrative> {
  const cached = getCachedNarrative(cacheKey);
  if (cached && cached.resultHash === context.hash) return cached;

  const fallback = deterministicNarrative(context);
  const generatedAt = new Date().toISOString();
  const prompt = JSON.stringify({
    instruction: "Summarize these verified QRouter job results. Do not add numbers that are not in the JSON.",
    report: aiPayloadFrom(context),
  });

  if (isGeminiConfigured()) {
    try {
      const result = await generateGeminiText({
        system: REPORT_SYSTEM_PROMPT,
        turns: [{ role: "user", text: prompt }],
        maxOutputTokens: 900,
        signal,
      });
      const narrative: ReportNarrative = {
        text: result.content.trim() || fallback,
        source: "gemini",
        model: result.model,
        generatedAt,
        resultHash: context.hash,
      };
      return setCachedNarrative(cacheKey, narrative);
    } catch {
      /* fall through */
    }
  }

  if (isAIInferenceConfigured()) {
    try {
      const result = await createAIChatCompletion({
        messages: [
          { role: "system", content: REPORT_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        maxTokens: 900,
        signal,
      });
      const narrative: ReportNarrative = {
        text: result.content.trim() || fallback,
        source: "inference",
        model: result.model,
        generatedAt,
        resultHash: context.hash,
      };
      return setCachedNarrative(cacheKey, narrative);
    } catch {
      /* fall through */
    }
  }

  return setCachedNarrative(cacheKey, {
    text: fallback,
    source: "qci-engine",
    model: "qci-engine",
    generatedAt,
    resultHash: context.hash,
  });
}
