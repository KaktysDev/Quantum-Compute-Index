// ─────────────────────────────────────────────────────────────────────────────
// Session introspection — "who is this key, and can it actually run anything?"
//
//   GET /api/v1/session   →  identity + credits + billing + runnable backends
//
// The terminal client (`npx qrouter.app`) calls this immediately after the user
// pastes a key: one round trip has to answer "is the key valid", "is it live or
// test", "what may it do", "is there money", and "is there a backend that can
// take a job right now". Anything that would make the very next job fail is
// reported here instead of surfacing as a mid-chat error.
//
// Nothing here executes, quotes, or routes: it reads the same catalog the router
// reads (loadRoutingContext) and narrows it with the same environment filter the
// job routes apply (backendsForPrincipal), so what it advertises and what a job
// may actually reach cannot drift apart.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { isAssistantConfigured } from "@/lib/ai/assistant";
import { quotaLimits } from "@/lib/ai/limits";
import { resolvePrincipal, type Principal } from "@/lib/qrouter/auth";
import { DEMO_BALANCE } from "@/lib/qrouter/demo-store";
import { apiError } from "@/lib/qrouter/http";
import { loadRoutingContext } from "@/lib/qrouter/routingContext";
import { backendsForPrincipal } from "@/lib/qrouter/scopes";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface Workspace {
  organizationId: string;
  organizationName: string;
  credits: { available: number | null; reserved: number | null };
  billingSetupComplete: boolean;
}

/**
 * Credits and billing state for the key's organization.
 *
 * Every lookup is best-effort: a missing `organizations` row or an un-migrated
 * database must not make a working key look invalid, so unknown values surface
 * as `null` and the client renders them as "unknown" rather than "$0.00" (which
 * would read as "you cannot run anything").
 */
async function loadWorkspace(principal: Principal): Promise<Workspace> {
  if (principal.demo) {
    return {
      organizationId: principal.organizationId,
      organizationName: "Local demo workspace",
      credits: { available: DEMO_BALANCE, reserved: 0 },
      billingSetupComplete: false,
    };
  }
  const admin = createAdminClient();
  const [organization, account] = await Promise.all([
    Promise.resolve(
      admin
        .from("organizations")
        .select("name,billing_setup_complete")
        .eq("id", principal.organizationId)
        .maybeSingle(),
    ).then(({ data }) => data, () => null),
    Promise.resolve(
      admin
        .from("credit_accounts")
        .select("available,reserved")
        .eq("organization_id", principal.organizationId)
        .maybeSingle(),
    ).then(({ data }) => data, () => null),
  ]);
  return {
    organizationId: principal.organizationId,
    organizationName: organization?.name ?? "your workspace",
    credits: {
      available: account ? Number(account.available) : null,
      reserved: account ? Number(account.reserved) : null,
    },
    billingSetupComplete: Boolean(organization?.billing_setup_complete),
  };
}

export async function GET(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    const [workspace, routing] = await Promise.all([
      loadWorkspace(principal),
      loadRoutingContext(principal.demo),
    ]);

    // The same narrowing the job routes apply, so a test key is told up front
    // that it sees simulators only instead of discovering it at submit time.
    const reachable = backendsForPrincipal(principal, routing.backends);
    const ready = reachable.filter((backend) => backend.available);

    return NextResponse.json({
      object: "session",
      authenticated: true,
      principal: {
        kind: principal.apiKeyId ? "api_key" : "session",
        environment: principal.environment ?? null,
        scopes: principal.scopes ?? [],
        demo: principal.demo,
      },
      organization: {
        id: workspace.organizationId,
        name: workspace.organizationName,
      },
      credits: workspace.credits,
      billing: { setup_complete: workspace.billingSetupComplete },
      backends: {
        // `reachable` is what this key may target at all; `ready` is what can
        // take a job this second. A key with reachable > 0 and ready === 0 is a
        // credentials problem on the deployment, not a problem with the key.
        reachable: reachable.length,
        ready: ready.map((backend) => ({
          id: backend.id,
          display_name: backend.displayName,
          provider: backend.provider,
          kind: backend.kind,
          qubits: backend.qubits,
          queue_seconds: backend.queueSeconds,
          price_per_shot: backend.pricePerShot,
        })),
      },
      qci: {
        timestamp: routing.snapshot.ts,
        source: routing.snapshot.source,
        index: routing.snapshot.price,
        price_per_qc_hour: routing.snapshot.vwap,
      },
      assistant: {
        configured: isAssistantConfigured(),
        limits: quotaLimits(),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
