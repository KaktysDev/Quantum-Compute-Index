"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityTable } from "@/components/activity/ActivityTable";
import { ExecutionDrawer } from "@/components/activity/ExecutionDrawer";
import { InlineAlert } from "@/components/console/ui";
import { ACTIVITY_FILTERS, loadActivityPage, mergeActivity, type ActivityFilter, type ActivityItem } from "@/lib/client/activity";
import { useAdvance } from "@/lib/client/use-advance";
import { onVisibleInterval } from "@/lib/client/visible-interval";
import { isSettled } from "@/lib/qrouter/status";

const PAGE = 25;

function setJobParam(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("job", id);
  else url.searchParams.delete("job");
  window.history.replaceState(null, "", url);
}

export function ActivityList({ circuitId, includeV1 = true }: { circuitId?: string; includeV1?: boolean }) {
  const [filter, setFilter] = useState<ActivityFilter>(ACTIVITY_FILTERS[0]);
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [cursors, setCursors] = useState<{ v2: string | null; v1: string | null }>({ v2: null, v1: null });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const requestRef = useRef(0);

  const refreshFirstPage = useCallback(async (reset: boolean) => {
    const request = ++requestRef.current;
    try {
      const page = await loadActivityPage({ limit: PAGE, filter, circuitId, includeV1 });
      if (request !== requestRef.current) return;
      setItems((current) => (reset ? page.items : mergeActivity(current, page.items)));
      if (reset) setCursors({ v2: page.v2NextCursor, v1: page.v1NextBefore });
      setError(null);
    } catch (value) {
      if (request === requestRef.current) setError(value instanceof Error ? value.message : "Could not load jobs.");
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [circuitId, filter, includeV1]);

  useEffect(() => {
    setLoading(true);
    void refreshFirstPage(true);
  }, [refreshFirstPage]);

  // Opening from a link: ?job= may name an execution or a whole job.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("job");
    if (id) setOpenId(id);
  }, []);
  useEffect(() => {
    if (!openId) return;
    const group = items.find((item) => item.id === openId && item.executions.length > 1);
    if (group) {
      setExpanded((current) => new Set(current).add(group.id));
      setOpenId(null);
      setJobParam(null);
    }
  }, [items, openId]);

  const executions = useMemo(() => items.flatMap((item) => item.executions), [items]);
  const inFlight = executions.some((execution) => !isSettled(execution.status));

  useEffect(() => onVisibleInterval(() => void refreshFirstPage(false), inFlight ? 5000 : 30000), [inFlight, refreshFirstPage]);
  useEffect(() => {
    if (!inFlight) return;
    return onVisibleInterval(() => setNow(Date.now()), 1000);
  }, [inFlight]);
  useAdvance(executions, () => void refreshFirstPage(false));

  async function loadMore() {
    setLoadingMore(true);
    try {
      const page = await loadActivityPage({ limit: PAGE, filter, circuitId, includeV1, v2Cursor: cursors.v2, v1Before: cursors.v1 });
      setItems((current) => mergeActivity(current, page.items));
      setCursors({ v2: page.v2NextCursor, v1: page.v1NextBefore });
    } catch (value) {
      setError(value instanceof Error ? value.message : "Could not load more jobs.");
    } finally {
      setLoadingMore(false);
    }
  }

  const toggle = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const open = useCallback((executionId: string) => {
    setOpenId(executionId);
    setJobParam(executionId);
  }, []);

  const close = useCallback(() => {
    setOpenId(null);
    setJobParam(null);
  }, []);

  const hasMore = cursors.v2 !== null || cursors.v1 !== null;
  const openTitle = openId ? items.find((item) => item.executions.some((execution) => execution.id === openId))?.name : undefined;
  const drawerOpen = openId && !items.some((item) => item.id === openId && item.executions.length > 1);

  return (
    <div className="stack">
      <div className="row-between">
        <div className="segmented" role="group" aria-label="Filter jobs">
          {ACTIVITY_FILTERS.map((option) => (
            <button key={option.id} type="button" aria-pressed={filter.id === option.id} onClick={() => setFilter(option)}>
              {option.label}
            </button>
          ))}
        </div>
        {inFlight ? <span className="dim row" style={{ gap: 6 }}><Loader2 size={13} className="spin" /> Updating</span> : null}
      </div>

      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

      <section className="panel">
        {loading ? (
          <div className="empty"><Loader2 size={16} className="spin" /></div>
        ) : (
          <ActivityTable
            items={items}
            now={now}
            expanded={expanded}
            selectedId={openId}
            onToggle={toggle}
            onOpen={(execution) => open(execution.id)}
            empty={
              circuitId && filter.id === "all" ? (
                "No jobs for this circuit yet. Start one with New run."
              ) : filter.id === "all" ? (
                <span>
                  No jobs yet. <Link href="/dashboard/run" className="link-btn">Run a circuit</Link> to see it here.
                </span>
              ) : (
                `No ${filter.label.toLowerCase()} jobs.`
              )
            }
          />
        )}
        {hasMore && !loading ? (
          <div className="panel-foot">
            <span>{items.length} jobs shown</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? <Loader2 size={13} className="spin" /> : null}
              Load more
            </button>
          </div>
        ) : null}
      </section>

      {drawerOpen ? (
        <ExecutionDrawer executionId={openId} title={openTitle} onClose={close} onChanged={() => void refreshFirstPage(false)} />
      ) : null}
    </div>
  );
}
