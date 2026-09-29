"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ActivityTable } from "@/components/activity/ActivityTable";
import { loadActivityPage, type ActivityItem } from "@/lib/client/activity";

/** Read-only latest jobs for the Overview. Rows link into Activity. */
export function RecentActivity({ limit = 6 }: { limit?: number }) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadActivityPage({ limit })
      .then((page) => setItems(page.items.slice(0, limit)))
      .catch((value) => setError(value instanceof Error ? value.message : "Could not load jobs."));
  }, [limit]);

  if (error) return <div className="empty"><p>{error}</p></div>;
  if (!items) return <div className="empty"><Loader2 size={16} className="spin" /></div>;
  return (
    <ActivityTable
      items={items}
      now={Date.now()}
      linkTo={(item) => `/dashboard/activity?job=${item.executions.length === 1 ? item.executions[0].id : item.id}`}
      empty={<span>No jobs yet. <Link href="/dashboard/run" className="link-btn">Run your first circuit</Link>.</span>}
    />
  );
}
