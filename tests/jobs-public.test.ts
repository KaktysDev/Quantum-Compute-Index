import { describe, expect, it } from "vitest";
import { GET as getJob } from "@/app/api/v1/jobs/[id]/route";
import { GET as listJobs, POST as createJob } from "@/app/api/v1/jobs/route";

const bell = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
measure q -> c;`;

function authed(url: string, init: RequestInit = {}) {
  return new Request(url, {
    ...init,
    headers: {
      authorization: "Bearer qci_test_local_development",
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

describe("job list vs inspector payloads", () => {
  it("keeps native programs off list/summary and owner GET, but leaves source on the inspector", async () => {
    const created = await createJob(authed("http://localhost/api/v1/jobs", {
      method: "POST",
      body: JSON.stringify({ circuit: bell, shots: 32, target: "qci-aer-gpu" }),
    }));
    const job = await created.json();
    expect(created.status).toBe(201);
    expect(job.source).toBe(bell);
    expect(JSON.stringify(job)).not.toMatch(/"payload"\s*:/);

    const summary = await (await listJobs(authed("http://localhost/api/v1/jobs?view=summary"))).json();
    const listed = summary.data.find((row: { id: string }) => row.id === job.id);
    expect(listed).toMatchObject({ id: job.id, status: job.status });
    expect(listed).not.toHaveProperty("source");
    expect(listed).not.toHaveProperty("route_decision");
    expect(listed.analysis).not.toHaveProperty("encoding");

    const full = await (await listJobs(authed("http://localhost/api/v1/jobs"))).json();
    const row = full.data.find((item: { id: string }) => item.id === job.id);
    expect(row).not.toHaveProperty("source");
    expect(JSON.stringify(row)).not.toMatch(/"payload"\s*:/);

    const detail = await getJob(authed(`http://localhost/api/v1/jobs/${job.id}`), { params: Promise.resolve({ id: job.id }) });
    const inspector = await detail.json();
    expect(inspector.source).toBe(bell);
    expect(JSON.stringify(inspector)).not.toMatch(/"payload"\s*:/);
  });
});
