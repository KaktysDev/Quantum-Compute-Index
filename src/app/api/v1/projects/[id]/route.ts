import { NextResponse } from "next/server";
import { z } from "zod";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { demoProjects } from "@/lib/qrouter/demo-store";
import { apiError } from "@/lib/qrouter/http";
import { normalizeCircuitPath, normalizeRef } from "@/lib/qrouter/repositories";
import { createAdminClient } from "@/lib/supabase/admin";

const settingDefaults = { failover: true, maxAttempts: 3, timeoutSeconds: 7200 };

const patchSchema = z.object({
  production_branch: z.string().optional(),
  circuit_path: z.string().optional(),
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

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await resolvePrincipal(request);
    const { id } = await context.params;
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: { type: "invalid_request", message: "The project update is invalid." } }, { status: 400 });
    const update: Record<string, unknown> = {
      ...(parsed.data.production_branch ? { production_branch: normalizeRef(parsed.data.production_branch) } : {}),
      ...(parsed.data.circuit_path ? { circuit_path: normalizeCircuitPath(parsed.data.circuit_path) } : {}),
      updated_at: new Date().toISOString(),
    };
    if (principal.demo) {
      const project = demoProjects.get(id);
      if (!project || project.organization_id !== principal.organizationId) return NextResponse.json({ error: { type: "not_found", message: "Project not found." } }, { status: 404 });
      const next = { ...project, ...update, ...(parsed.data.settings ? { settings: { ...settingDefaults, ...project.settings, ...parsed.data.settings } } : {}) } as typeof project;
      demoProjects.set(id, next);
      return NextResponse.json(next);
    }
    const admin = createAdminClient();
    if (parsed.data.settings) {
      const { data: existing, error: existingError } = await admin.from("projects").select("settings").eq("id", id).eq("organization_id", principal.organizationId).maybeSingle();
      if (existingError) throw existingError;
      if (!existing) return NextResponse.json({ error: { type: "not_found", message: "Project not found." } }, { status: 404 });
      update.settings = { ...settingDefaults, ...(existing.settings ?? {}), ...parsed.data.settings };
    }
    const { data, error } = await admin.from("projects").update(update).eq("id", id).eq("organization_id", principal.organizationId).select("*").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: { type: "not_found", message: "Project not found." } }, { status: 404 });
    return NextResponse.json(data);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await resolvePrincipal(request);
    const { id } = await context.params;
    if (principal.demo) {
      const project = demoProjects.get(id);
      if (!project || project.organization_id !== principal.organizationId) return NextResponse.json({ error: { type: "not_found", message: "Project not found." } }, { status: 404 });
      demoProjects.delete(id);
      return new NextResponse(null, { status: 204 });
    }
    const { error } = await createAdminClient().from("projects").delete().eq("id", id).eq("organization_id", principal.organizationId);
    if (error) throw error;
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
