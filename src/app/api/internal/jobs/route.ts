import { NextResponse } from "next/server";
import { getProviderStatus } from "@/lib/qrouter/execution";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}` || !process.env.CRON_SECRET) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const { data: jobs, error } = await admin.from("jobs").select("id,status,selected_backend_id,provider_job_id,quote_id").in("status", ["submitted", "processing", "cancellation_requested"]).not("provider_job_id", "is", null).limit(25);
  if (error) throw error;
  const updates: Array<{ id: string; status: string }> = [];
  for (const job of jobs ?? []) {
    try {
      const provider = await getProviderStatus(job.selected_backend_id, job.provider_job_id);
      if (provider.status === job.status) continue;
      const terminal = ["completed", "failed", "cancelled"].includes(provider.status);
      await admin.from("jobs").update({ status: provider.status, result: provider.result ?? null, error: provider.error ? { message: provider.error } : null, updated_at: new Date().toISOString(), completed_at: terminal ? new Date().toISOString() : null }).eq("id", job.id);
      await admin.from("job_events").insert({ job_id: job.id, type: `job.${provider.status}`, from_status: job.status, to_status: provider.status });
      if (terminal) {
        const { data: quote } = await admin.from("quotes").select("total").eq("id", job.quote_id).single();
        if (quote) {
          if (provider.status === "completed") await admin.rpc("settle_job_credits", { p_job_id: job.id, p_reserved: quote.total, p_actual: quote.total });
          else await admin.rpc("release_job_credits", { p_job_id: job.id, p_amount: quote.total });
        }
      }
      updates.push({ id: job.id, status: provider.status });
    } catch (pollError) {
      console.error(`Failed to poll job ${job.id}`, pollError);
    }
  }
  return NextResponse.json({ checked: jobs?.length ?? 0, updates });
}

