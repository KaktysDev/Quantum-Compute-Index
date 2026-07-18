import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { demoProjects } from "@/lib/qrouter/demo-store";
import { apiError } from "@/lib/qrouter/http";
import { getGithubAccessToken } from "@/lib/qrouter/github";
import { inspectRepository, normalizeCircuitPath, normalizeRef, RepositorySourceError, type ProjectSettings, type QRouterProject } from "@/lib/qrouter/repositories";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  repository: z.string().min(3).max(220),
  production_branch: z.string().min(1).max(255).optional(),
  circuit_path: z.string().min(1).max(1024).optional(),
  settings: z.object({
    shots: z.number().int().min(1).max(1_000_000).optional(),
    target: z.string().optional(),
    routingMode: z.enum(["balanced", "cost", "speed", "quality"]).optional(),
    optimizationLevel: z.number().int().min(0).max(3).optional(),
    failover: z.boolean().optional(),
    maxAttempts: z.number().int().min(1).max(5).optional(),
    timeoutSeconds: z.number().int().min(60).max(604_800).optional(),
  }).optional(),
});

export async function GET(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    if (principal.demo) {
      const data = [...demoProjects.values()]
        .filter((project) => project.organization_id === principal.organizationId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      return NextResponse.json({ object: "list", data });
    }
    const { data, error } = await createAdminClient().from("projects").select("*").eq("organization_id", principal.organizationId).order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ object: "list", data });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: { type: "invalid_request", message: "The project configuration is invalid.", details: parsed.error.flatten() } }, { status: 400 });
    const inspection = await inspectRepository(parsed.data.repository, parsed.data.production_branch, await getGithubAccessToken(principal));
    const configuredPath = typeof inspection.config?.circuit === "string" ? inspection.config.circuit : undefined;
    const circuitPath = normalizeCircuitPath(parsed.data.circuit_path || configuredPath || inspection.files[0]?.path || "");
    if (!inspection.files.some((file) => file.path === circuitPath)) throw new RepositorySourceError("The selected circuit was not found in the repository tree.", 404, "repository_file_not_found");
    const productionBranch = normalizeRef(parsed.data.production_branch || inspection.repository.defaultBranch);
    const now = new Date().toISOString();
    const config = inspection.config ?? {};
    const configMode = ["balanced", "cost", "speed", "quality"].includes(String(config.routing_mode))
      ? config.routing_mode as ProjectSettings["routingMode"] : "balanced";
    const settings: ProjectSettings = {
      shots: parsed.data.settings?.shots ?? (typeof config.shots === "number" && Number.isInteger(config.shots) && config.shots >= 1 && config.shots <= 1_000_000 ? config.shots : 1024),
      target: parsed.data.settings?.target ?? (typeof config.target === "string" ? config.target : "auto"),
      routingMode: parsed.data.settings?.routingMode ?? configMode,
      optimizationLevel: parsed.data.settings?.optimizationLevel ?? (typeof config.optimization_level === "number" && Number.isInteger(config.optimization_level) && config.optimization_level >= 0 && config.optimization_level <= 3 ? config.optimization_level : 2),
      failover: parsed.data.settings?.failover ?? (typeof config.failover === "boolean" ? config.failover : true),
      maxAttempts: parsed.data.settings?.maxAttempts ?? (typeof config.max_attempts === "number" && Number.isInteger(config.max_attempts) && config.max_attempts >= 1 && config.max_attempts <= 5 ? config.max_attempts : 3),
      timeoutSeconds: parsed.data.settings?.timeoutSeconds ?? (typeof config.timeout_seconds === "number" && Number.isInteger(config.timeout_seconds) && config.timeout_seconds >= 60 && config.timeout_seconds <= 604_800 ? config.timeout_seconds : 7200),
    };

    if (principal.demo) {
      const existing = [...demoProjects.values()].find((project) => project.organization_id === principal.organizationId && project.repository === inspection.repository.fullName);
      const project: QRouterProject = {
        id: existing?.id ?? randomUUID(), organization_id: principal.organizationId,
        name: inspection.repository.fullName.split("/").at(-1)!, repository: inspection.repository.fullName,
        repository_url: inspection.repository.htmlUrl, default_branch: inspection.repository.defaultBranch,
        production_branch: productionBranch, circuit_path: circuitPath, settings,
        created_at: existing?.created_at ?? now, updated_at: now, last_deployed_at: existing?.last_deployed_at ?? null,
      };
      demoProjects.set(project.id, project);
      return NextResponse.json(project, { status: existing ? 200 : 201 });
    }

    const { data, error } = await createAdminClient().from("projects").upsert({
      organization_id: principal.organizationId,
      name: inspection.repository.fullName.split("/").at(-1),
      repository: inspection.repository.fullName,
      repository_url: inspection.repository.htmlUrl,
      default_branch: inspection.repository.defaultBranch,
      production_branch: productionBranch,
      circuit_path: circuitPath,
      settings,
      updated_at: now,
    }, { onConflict: "organization_id,repository" }).select("*").single();
    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
