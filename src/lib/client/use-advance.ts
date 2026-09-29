"use client";

// Keeps on-screen jobs moving on deployments without a fleet scheduler.
//
// POST /api/v1/jobs/:id/advance runs the same dispatcher step as the cron
// worker, scoped to the caller's own job and guarded by the job lease, so it
// is safe to call alongside a real scheduler. Calls are throttled per job,
// capped in flight, and only made while the tab is visible.

import { useEffect, useRef } from "react";
import { onVisibleInterval } from "@/lib/client/visible-interval";
import { isAdvanceable } from "@/lib/qrouter/status";

const PER_JOB_MS = 10_000;
const MAX_IN_FLIGHT = 2;

const lastCalled = new Map<string, number>();
const inFlight = new Set<string>();

async function advance(id: string): Promise<boolean> {
  inFlight.add(id);
  lastCalled.set(id, Date.now());
  try {
    const response = await fetch(`/api/v1/jobs/${id}/advance`, { method: "POST" });
    return response.ok;
  } catch {
    return false;
  } finally {
    inFlight.delete(id);
  }
}

export function useAdvance(jobs: Array<{ id: string; status: string }>, onAdvanced?: () => void) {
  const jobsRef = useRef(jobs);
  const callbackRef = useRef(onAdvanced);
  jobsRef.current = jobs;
  callbackRef.current = onAdvanced;

  const pending = jobs.filter((job) => isAdvanceable(job.status)).length > 0;

  useEffect(() => {
    if (!pending) return;
    const tick = () => {
      const now = Date.now();
      const due = jobsRef.current.filter(
        (job) => isAdvanceable(job.status) && !inFlight.has(job.id) && now - (lastCalled.get(job.id) ?? 0) >= PER_JOB_MS,
      );
      const room = Math.max(0, MAX_IN_FLIGHT - inFlight.size);
      for (const job of due.slice(0, room)) {
        void advance(job.id).then((ok) => {
          if (ok) callbackRef.current?.();
        });
      }
    };
    tick();
    return onVisibleInterval(tick, 5000);
  }, [pending]);
}
