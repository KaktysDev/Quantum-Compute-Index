import { NextResponse } from "next/server";
import { storeArtifact } from "@/lib/qrouter/artifacts";
import { getProviderStatus } from "@/lib/qrouter/execution";
import { dispatchJobWebhook } from "@/lib/qrouter/webhooks";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: jobs, error } = await admin
    .from("jobs")
    .select("id,status,selected_backend_id,provider_job_id")
    .in("status", ["submitted", "processing", "cancellation_requested"])
    .not("provider_job_id", "is", null)
    .limit(25);
  if (error) throw error;
  const updates: Array<{ id: string; status: string }> = [];
  for (const job of jobs ?? []) {
    try {
      const provider = await getProviderStatus(job.selected_backend_id, job.provider_job_id);
      if (provider.status === job.status) continue;
      const terminal = ["completed", "failed", "cancelled"].includes(provider.status);
      if (provider.status === "completed" && provider.result) {
        const { data: jobOwner } = await admin.from("jobs").select("organization_id").eq("id", job.id).single();
        if (jobOwner) {
          await storeArtifact({
            jobId: job.id,
            organizationId: jobOwner.organization_id,
            kind: "result",
            content: JSON.stringify(provider.result),
          });
        }
      }
      await admin.from("jobs").update({
        status: provider.status,
        result: provider.result ? { available: true, encrypted: true } : null,
        error: provider.error ? { message: provider.error } : null,
        updated_at: new Date().toISOString(),
        completed_at: terminal ? new Date().toISOString() : null,
      }).eq("id", job.id);
      await admin.from("job_events").insert({
        job_id: job.id,
        type: `job.${provider.status}`,
        from_status: job.status,
        to_status: provider.status,
      });
      if (terminal) {
        const { data: quote } = await admin
          .from("quotes")
          .select("total,provider_cost,transpiler_fee,platform_fee")
          .eq("job_id", job.id)
          .single();
        if (quote) {
          if (provider.status === "completed") {
            const reconciled = provider.actualProviderCost == null
              ? Number(quote.total)
              : Math.min(
                  Number(quote.total),
                  provider.actualProviderCost + Number(quote.transpiler_fee) + Number(quote.platform_fee),
                );
            await admin.rpc("settle_job_credits", {
              p_job_id: job.id,
              p_reserved: quote.total,
              p_actual: reconciled,
            });
            await admin.from("job_events").insert({
              job_id: job.id,
              type: "provider.cost_reconciled",
              payload: { quoted: quote.total, actual: reconciled, providerCost: provider.actualProviderCost ?? quote.provider_cost },
            });
          } else {
            await admin.rpc("release_job_credits", { p_job_id: job.id, p_amount: quote.total });
          }
        }
        await dispatchJobWebhook(job.id, `job.${provider.status}`);
      }
      updates.push({ id: job.id, status: provider.status });
    } catch (pollError) {
      console.error(`Poll failed ${job.id}`, pollError);
    }
  }
  return NextResponse.json({ checked: jobs?.length ?? 0, updates });
}

export const GET = POST;
