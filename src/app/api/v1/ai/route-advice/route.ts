import { NextResponse } from "next/server";
import { z } from "zod";
import type { QpuComponent } from "@/lib/qci/types";
import { getLatestSnapshot } from "@/lib/qci/store";
import { analyzeCircuit } from "@/lib/qrouter/analyze";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { withQciSnapshot } from "@/lib/qrouter/catalog";
import { apiError } from "@/lib/qrouter/http";
import { buildQuote, routeCircuit } from "@/lib/qrouter/route";
import { applyProviderHealth, loadPersistedBackendHealth } from "@/lib/qrouter/providerHealth";
import { createJobSchema } from "@/lib/qrouter/validation";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createVultrChatCompletionWithFallback,
  isVultrInferenceConfigured,
} from "@/lib/vultr/inference";

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

async function snapshotForPrincipal(demo: boolean) {
  if (demo) {
    const latest = await getLatestSnapshot();
    return { id: null, ts: latest.ts, components: latest.components };
  }
  const { data } = await createAdminClient()
    .from("qci_snapshots")
    .select("id,ts,components")
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    id: data?.id ?? null,
    ts: data?.ts ?? new Date().toISOString(),
    components: (data?.components ?? []) as QpuComponent[],
  };
}

export async function POST(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    const parsed = adviceSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: { type: "invalid_request", message: "The request body is invalid.", details: parsed.error.flatten() } }, { status: 400 });
    }
    if (!isVultrInferenceConfigured()) {
      return NextResponse.json({ error: { type: "configuration_error", message: "AI route advisor is not configured." } }, { status: 503 });
    }

    const input = parsed.data;
    const analysis = analyzeCircuit(input.circuit, input.format);
    const snapshot = await snapshotForPrincipal(principal.demo);
    const backendHealth = principal.demo ? [] : await loadPersistedBackendHealth();
    const decision = routeCircuit({
      backends: applyProviderHealth(withQciSnapshot(snapshot.components), backendHealth),
      analysis,
      shots: input.shots,
      target: input.target,
      mode: input.routing_mode,
      constraints: input.constraints,
      qciSnapshotId: snapshot.id,
      qciTimestamp: snapshot.ts,
    });
    const quote = buildQuote(decision, analysis, input.shots);
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
      question: input.question ?? "Explain the selected route, the main tradeoff, and one practical optimization to try next.",
    };

    const completion = await createVultrChatCompletionWithFallback({
      messages: [
        {
          role: "system",
          content: [
            "You are the QRouter route advisor.",
            "Use only the supplied routing JSON.",
            "Do not override QRouter's selected backend.",
            "Keep the response under 180 words with short bullets.",
            "Call out uncertainty when provider credentials or live queue data are missing.",
          ].join(" "),
        },
        { role: "user", content: JSON.stringify(prompt) },
      ],
    });

    return NextResponse.json({
      advice: completion.content,
      model: completion.model,
      usage: completion.usage,
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
