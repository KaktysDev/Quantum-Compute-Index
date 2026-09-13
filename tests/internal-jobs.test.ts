import { beforeEach, describe, expect, it, vi } from "vitest";

const dispatchJob = vi.hoisted(() => vi.fn());
const pollJob = vi.hoisted(() => vi.fn());
const authorizeCronRequest = vi.hoisted(() => vi.fn(() => true));
const rpc = vi.hoisted(() => vi.fn());
const processWebhookDeliveries = vi.hoisted(() => vi.fn(async () => ({ claimed: 0 })));

vi.mock("@/lib/qrouter/dispatcher", () => ({
  dispatchJob,
  pollJob,
}));

vi.mock("@/lib/security/secrets", () => ({
  authorizeCronRequest,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc }),
}));

vi.mock("@/lib/qrouter/webhooks", () => ({
  processWebhookDeliveries,
}));

import { POST } from "@/app/api/internal/jobs/route";

describe("internal jobs worker isolation", () => {
  beforeEach(() => {
    dispatchJob.mockReset();
    pollJob.mockReset();
    authorizeCronRequest.mockReset();
    authorizeCronRequest.mockReturnValue(true);
    rpc.mockReset();
    processWebhookDeliveries.mockReset();
    processWebhookDeliveries.mockResolvedValue({ claimed: 0 });
  });

  it("finishes the rest of a claimed batch when one dispatch throws", async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === "claim_qrouter_jobs") {
        return { data: [{ id: "job-a" }, { id: "job-b" }, { id: "job-c" }], error: null };
      }
      return { data: [], error: null };
    });
    dispatchJob
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("provider exploded"))
      .mockResolvedValueOnce(undefined);

    const response = await POST(new Request("http://localhost/api/internal/jobs", { method: "POST" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(dispatchJob).toHaveBeenCalledTimes(3);
    expect(body.updates).toEqual([
      { id: "job-a", action: "dispatched" },
      { id: "job-b", action: "dispatch_failed" },
      { id: "job-c", action: "dispatched" },
    ]);
  });
});
