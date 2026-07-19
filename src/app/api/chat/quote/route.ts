// Live pre-flight quote for the chat's job-confirmation card: runs the real
// routing engine (compatibility → constraints → scoring → quote) WITHOUT
// executing anything, so the user confirms against QRouter's numbers — never
// the model's. Mirrors /api/v1/ai/route-advice minus the LLM commentary.

import { NextResponse } from "next/server";
import type { QpuComponent } from "@/lib/qci/types";
import { getLatestSnapshot } from "@/lib/qci/store";
import { analyzeCircuit } from "@/lib/qrouter/analyze";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { withQciSnapshot } from "@/lib/qrouter/catalog";
import { apiError } from "@/lib/qrouter/http";
import { applyProviderHealth, loadPersistedBackendHealth } from "@/lib/qrouter/providerHealth";
import { buildQuote, routeCircuit } from "@/lib/qrouter/route";
import { createJobSchema } from "@/lib/qrouter/validation";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    const parsed = createJobSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: { type: "invalid_request", message: "The proposal is invalid.", details: parsed.error.flatten() } },
        { status: 400 },
      );
    }
    const input = parsed.data;
    const analysis = analyzeCircuit(input.circuit, input.format);

    let snapshot: { id: number | null; ts: string; components: QpuComponent[] };
    if (principal.demo) {
      const latest = await getLatestSnapshot();
      snapshot = { id: null, ts: latest.ts, components: latest.components };
    } else {
      const { data } = await createAdminClient()
        .from("qci_snapshots")
        .select("id,ts,components")
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle();
      snapshot = {
        id: data?.id ?? null,
        ts: data?.ts ?? new Date().toISOString(),
        components: (data?.components ?? []) as QpuComponent[],
      };
    }

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

    return NextResponse.json({
      analysis: {
        qubits: analysis.qubits,
        depth: analysis.depth,
        gates: analysis.gates,
        twoQubitGates: analysis.twoQubitGates,
        complexity: analysis.complexity,
      },
      decision: {
        selected: {
          id: decision.selected.id,
          displayName: decision.selected.displayName,
          provider: decision.selected.provider,
          kind: decision.selected.kind,
          queueSeconds: decision.selected.queueSeconds,
        },
        explanation: decision.explanation,
      },
      quote,
    });
  } catch (error) {
    return apiError(error);
  }
}
