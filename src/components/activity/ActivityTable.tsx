"use client";

// One table for jobs everywhere in the console: Activity, Overview and a
// circuit's page. A multi-target job expands into its executions; a single
// execution opens straight into the inspector.

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Fragment } from "react";
import { StatusBadge, Timestamp } from "@/components/console/ui";
import { backendLabel, type ActivityItem, type ExecutionRow } from "@/lib/client/activity";
import { costView, formatUsd } from "@/lib/qrouter/cost";
import { elapsedMs, formatDuration } from "@/lib/qrouter/duration";

function Cost({ status, quoted, charged }: { status: string; quoted: number | null; charged: number | null }) {
  const view = costView({ status, quoted, charged });
  return (
    <span className="cell-main num">
      <span>{view.amount === null ? <span className="dim">—</span> : formatUsd(view.amount)}</span>
      <small>{view.label}</small>
    </span>
  );
}

function targetsLabel(item: ActivityItem) {
  if (item.executions.length === 1) return backendLabel(item.executions[0].backend);
  return `${item.executions.length} targets`;
}

function duration(row: { status: string; created_at: string; started_at?: string | null; completed_at: string | null; updated_at: string | null }, now: number) {
  return formatDuration(elapsedMs(row, now));
}

export function ActivityTable({
  items,
  now,
  expanded,
  selectedId,
  onToggle,
  onOpen,
  linkTo,
  empty,
}: {
  items: ActivityItem[];
  now: number;
  expanded?: Set<string>;
  selectedId?: string | null;
  onToggle?: (id: string) => void;
  onOpen?: (execution: ExecutionRow, item: ActivityItem) => void;
  /** Read-only mode: rows link to Activity instead of opening in place. */
  linkTo?: (item: ActivityItem) => string;
  empty?: React.ReactNode;
}) {
  return (
    <div className="table-wrap">
      <table className="qr-table activity-table">
        <thead>
          <tr>
            <th>Job</th>
            <th>Status</th>
            <th className="hide-sm">Target</th>
            <th className="num hide-sm">Shots</th>
            <th className="num hide-sm">Duration</th>
            <th className="num">Cost</th>
            <th className="hide-sm">Created</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={7} className="empty-row">{empty ?? "No jobs yet."}</td>
            </tr>
          ) : (
            items.map((item) => {
              const multi = item.executions.length > 1;
              const open = Boolean(expanded?.has(item.id));
              const single = item.executions[0];
              const activate = () => {
                if (linkTo) return;
                if (multi) onToggle?.(item.id);
                else if (single) onOpen?.(single, item);
              };
              const name = (
                <span className="activity-name">
                  {multi && !linkTo ? <ChevronRight size={14} className={`activity-chevron${open ? " open" : ""}`} aria-hidden="true" /> : null}
                  <span className="cell-main">
                    <b className="truncate">{item.name}</b>
                    <small className="mono">
                      {item.id.slice(0, 8)}
                      {item.legacy ? " · v1" : ""}
                    </small>
                  </span>
                </span>
              );
              return (
                <Fragment key={item.id}>
                  <tr
                    className={`clickable${!multi && selectedId === single?.id ? " selected" : ""}`}
                    onClick={activate}
                    aria-expanded={multi && !linkTo ? open : undefined}
                  >
                    <td>
                      {linkTo ? (
                        <Link href={linkTo(item)} className="row-link">{name}</Link>
                      ) : (
                        <button type="button" className="row-link" onClick={(event) => { event.stopPropagation(); activate(); }}>
                          {name}
                        </button>
                      )}
                    </td>
                    <td><StatusBadge status={item.status} /></td>
                    <td className="hide-sm">{targetsLabel(item)}</td>
                    <td className="num hide-sm">{item.executions.reduce((total, execution) => total + execution.shots, 0).toLocaleString()}</td>
                    <td className="num hide-sm">{duration({ ...item, started_at: single?.started_at }, now)}</td>
                    <td className="num"><Cost status={item.status} quoted={item.quoted} charged={item.charged} /></td>
                    <td className="hide-sm"><Timestamp value={item.created_at} /></td>
                  </tr>
                  {multi && open && !linkTo
                    ? item.executions.map((execution) => (
                        <tr
                          key={execution.id}
                          className={`clickable activity-execution${selectedId === execution.id ? " selected" : ""}`}
                          onClick={() => onOpen?.(execution, item)}
                        >
                          <td>
                            <button type="button" className="row-link" onClick={(event) => { event.stopPropagation(); onOpen?.(execution, item); }}>
                              <span className="cell-main">
                                <b className="truncate">{execution.key ?? execution.id.slice(0, 8)}</b>
                                <small className="mono">{execution.id.slice(0, 8)}</small>
                              </span>
                            </button>
                          </td>
                          <td><StatusBadge status={execution.status} /></td>
                          <td className="hide-sm">{backendLabel(execution.backend)}</td>
                          <td className="num hide-sm">{execution.shots.toLocaleString()}</td>
                          <td className="num hide-sm">{duration(execution, now)}</td>
                          <td className="num"><Cost status={execution.status} quoted={execution.quoted} charged={execution.charged} /></td>
                          <td className="hide-sm" />
                        </tr>
                      ))
                    : null}
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
