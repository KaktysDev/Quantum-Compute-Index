import { NextResponse } from "next/server";
import { z } from "zod";
import { POST as createJob } from "@/app/api/v1/jobs/route";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { demoJobs, demoProjects } from "@/lib/qrouter/demo-store";
import { apiError } from "@/lib/qrouter/http";
import { getGithubAccess } from "@/lib/qrouter/github";
import { normalizeCircuitPath, normalizeRef, readCircuitFromRepository, type ProjectSettings, type QRouterProject } from "@/lib/qrouter/repositories";
import { requireScope } from "@/lib/qrouter/scopes";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  project_id: z.string().uuid(),
  ref: z.string().optional(),
  circuit_path: z.string().optional(),
  deployment_id: z.string().max(120).optional(),
  settings: z.object({
    shots: z.number().int().min(1).max(1_000_000),
    target: z.string(),
    routingMode: z.enum(["balanced", "cost", "speed", "quality"]),
    optimizationLevel: z.number().int().min(0).max(3),
    failover: z.boolean().optional(),
    maxAttempts: z.number().int().min(1).max(5).optional(),
    timeoutSeconds: z.number().int().min(60).max(604_800).optional(),
  }).optional(),
});

export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    requireScope(principal, "jobs:read");
    const projectId = new URL(request.url).searchParams.get("project_id");
    if (!projectId) return NextResponse.json({ error: { type: "invalid_request", message: "project_id is required." } }, { status: 400 });
    if (principal.demo) {
      const data = [...demoJobs.values()]
        .filter((job) => job.organization_id === principal.organizationId && job.project_id === projectId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      return NextResponse.json({ object: "list", data });
    }
    const { data, error } = await createAdminClient().from("jobs")
      .select("id,project_id,name,status,selected_backend_id,analysis,result,error,created_at,updated_at,completed_at,quotes!job_id(total)")
      .eq("organization_id", principal.organizationId).eq("project_id", projectId).order("created_at", { ascending: false }).limit(50);
    if (error) throw error;
    return NextResponse.json({ object: "list", data });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    requireScope(principal, "jobs:write");
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: { type: "invalid_request", message: "The repository deployment is invalid.", details: parsed.error.flatten() } }, { status: 400 });
    let project: QRouterProject | null;
    if (principal.demo) {
      project = demoProjects.get(parsed.data.project_id) ?? null;
    } else {
      const { data, error } = await createAdminClient().from("projects").select("*").eq("id", parsed.data.project_id).eq("organization_id", principal.organizationId).maybeSingle();
      if (error) throw error;
      project = data as QRouterProject | null;
    }
    if (!project || project.organization_id !== principal.organizationId) return NextResponse.json({ error: { type: "not_found", message: "Project not found." } }, { status: 404 });

    const ref = normalizeRef(parsed.data.ref || project.production_branch);
    const circuitPath = normalizeCircuitPath(parsed.data.circuit_path || project.circuit_path);
    const settings: ProjectSettings = Object.assign({ failover: true, maxAttempts: 3, timeoutSeconds: 7200 }, project.settings, parsed.data.settings ?? {});
    const access = await getGithubAccess(principal);
    const source = await readCircuitFromRepository(project.repository, ref, circuitPath, { token: access.token, allowPrivate: access.allowPrivate });
    const headers = new Headers(request.headers);
    headers.set("content-type", "application/json");
    headers.set("idempotency-key", `repo:${project.id}:${parsed.data.deployment_id || source.sha}`);
    const jobResponse = await createJob(new Request(new URL("/api/v1/jobs", request.url), {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: `${project.name}:${source.path}@${source.sha.slice(0, 7)}`,
        circuit: source.text,
        format: source.version === 3 ? "openqasm3" : "openqasm2",
        shots: settings.shots,
        target: settings.target,
        routing_mode: settings.routingMode,
        optimization_level: settings.optimizationLevel,
        failover: settings.failover,
        max_attempts: settings.maxAttempts,
        timeout_seconds: settings.timeoutSeconds,
      }),
    }));
    const job = await jobResponse.json() as Record<string, unknown> & { error?: { job_id?: string } };
    // Paywalled deploys (402) still create a parked job; link it to the project
    // so it appears in the deployments list and can resume after payment.
    const jobId = typeof job.id === "string" ? job.id : typeof job.error?.job_id === "string" ? job.error.job_id : null;
    if (jobId) {
      const deployedAt = new Date().toISOString();
      if (principal.demo) {
        const stored = demoJobs.get(jobId);
        if (stored) stored.project_id = project.id;
        demoProjects.set(project.id, { ...project, last_deployed_at: deployedAt, updated_at: deployedAt });
      } else {
        const admin = createAdminClient();
        const [jobUpdate, projectUpdate] = await Promise.all([
          admin.from("jobs").update({ project_id: project.id }).eq("id", jobId).eq("organization_id", principal.organizationId),
          admin.from("projects").update({ last_deployed_at: deployedAt, updated_at: deployedAt }).eq("id", project.id),
        ]);
        if (jobUpdate.error) throw jobUpdate.error;
        if (projectUpdate.error) throw projectUpdate.error;
      }
    }
    return NextResponse.json({
      ...job,
      deployment: { project_id: project.id, repository: project.repository, ref, path: source.path, sha: source.sha, source_url: source.htmlUrl },
    }, { status: jobResponse.status });
  } catch (error) {
    return apiError(error);
  }
}
