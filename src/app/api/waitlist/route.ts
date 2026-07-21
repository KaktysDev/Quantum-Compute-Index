import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { validateWaitlistSubmission } from "@/lib/waitlist";

export const dynamic = "force-dynamic";

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Waitlist intake is temporarily unavailable." }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (clean(body.website, 200)) return NextResponse.json({ ok: true });

  const validation = validateWaitlistSubmission(body);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });
  const { name, email, linkedinUrl, jobTitle, quantumExperience, referralSource } = validation.submission;

  try {
    const admin = createAdminClient();
    const { error } = await admin.from("waitlist_submissions").upsert({
      name,
      email,
      linkedin_url: linkedinUrl,
      job_title: jobTitle,
      quantum_experience: quantumExperience,
      referral_source: referralSource,
      updated_at: new Date().toISOString(),
    }, { onConflict: "email" });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("waitlist submission failed", error);
    return NextResponse.json({ error: "We could not save your request. Please try again." }, { status: 500 });
  }
}
