import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

const ReportSchema = z.object({
  category: z.enum(["bug", "billing", "provider", "account", "other"]),
  subject: z.string().trim().min(3).max(200),
  message: z.string().trim().min(10).max(5000),
});

/** POST: a signed-in user files a support report (RLS: insert-own). */
export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let parsed: z.infer<typeof ReportSchema>;
  try {
    parsed = ReportSchema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { error: "Invalid report — check subject (3+ chars) and message (10+ chars)." },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("user_reports")
    .insert({
      user_id: user.id,
      email: user.email,
      category: parsed.category,
      subject: parsed.subject,
      message: parsed.message,
    })
    .select("id, category, subject, message, status, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ report: data });
}
