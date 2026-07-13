import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/admin";

export const dynamic = "force-dynamic";

const UpdateSchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
  admin_notes: z.string().max(5000).nullable().optional(),
});

/** PATCH: admin updates a support report's status / response notes. */
export async function PATCH(req: Request) {
  const ctx = await requireAdminApi();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let parsed: z.infer<typeof UpdateSchema>;
  try {
    parsed = UpdateSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.status !== undefined) patch.status = parsed.status;
  if (parsed.admin_notes !== undefined) patch.admin_notes = parsed.admin_notes;

  // The user-scoped client is fine here — RLS "reports: admin update" allows it.
  const { data, error } = await ctx.supabase
    .from("user_reports")
    .update(patch)
    .eq("id", parsed.id)
    .select("id, status, admin_notes")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ report: data });
}
