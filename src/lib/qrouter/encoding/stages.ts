import type { EncodingStage } from "./types";

/** Landing-page stage order, filled from the real encoding trace + job status. */
const LANDING_ORDER: EncodingStage["id"][] = ["analyze", "transpile", "score", "route", "execute"];

export function overlayExecute(stages: EncodingStage[] | undefined, jobStatus?: string): EncodingStage[] {
  const base = stages?.length
    ? stages
    : LANDING_ORDER.map((id) => ({
      id,
      label: id[0].toUpperCase() + id.slice(1),
      paper: "",
      status: "pending" as const,
      detail: "",
    }));
  const byId = new Map(base.map((item) => [item.id, item]));
  const execute = byId.get("execute");
  if (execute && jobStatus) {
    const running = ["dispatching", "submitted", "processing", "cancellation_requested"].includes(jobStatus);
    const done = jobStatus === "completed";
    const failed = jobStatus === "failed" || jobStatus === "cancelled";
    byId.set("execute", {
      ...execute,
      status: done ? "done" : failed ? "failed" : running ? "running" : execute.status,
      detail: done ? "result decoded" : failed ? jobStatus : running ? jobStatus.replaceAll("_", " ") : execute.detail,
    });
  }
  return LANDING_ORDER.map((id) => byId.get(id)).filter((item): item is EncodingStage => Boolean(item));
}
