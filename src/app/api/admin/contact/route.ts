import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/admin";

export const dynamic = "force-dynamic";

const UpdateSchema = z.object({
  id: z.number().int().positive(),
  read: z.boolean(),
});

/** PATCH: admin toggles read/unread on a contact submission. */
export async function PATCH(req: Request) {
  const ctx = await requireAdminApi();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let parsed: z.infer<typeof UpdateSchema>;
  try {
    parsed = UpdateSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { error } = await ctx.supabase
    .from("contact_submissions")
    .update({ read: parsed.read })
    .eq("id", parsed.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
