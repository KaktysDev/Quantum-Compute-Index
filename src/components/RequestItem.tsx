"use client";

import { useState } from "react";

export interface ContactSubmission {
  id: number;
  name: string;
  email: string;
  phone: string;
  message: string;
  read: boolean;
  created_at: string;
}

export default function RequestItem({ item }: { item: ContactSubmission }) {
  const [read, setRead] = useState(item.read);
  const [busy, setBusy] = useState(false);

  const when = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(item.created_at));

  async function toggle() {
    setBusy(true);
    try {
      const res = await fetch("/api/contact", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, read: !read }),
      });
      if (res.ok) setRead(!read);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`glass rounded-2xl p-6 transition-opacity ${read ? "opacity-60" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            {!read && (
              <span className="h-2 w-2 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.7)]" />
            )}
            <h3 className="text-lg font-medium text-white">{item.name}</h3>
          </div>
          <p className="mono-label mt-1 normal-case tracking-normal">
            <a href={`mailto:${item.email}`} className="hover:text-white">
              {item.email}
            </a>{" "}
            ·{" "}
            <a href={`tel:${item.phone}`} className="hover:text-white">
              {item.phone}
            </a>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="mono-label normal-case tracking-normal text-[var(--muted-dim)]">
            {when} ET
          </span>
          <button onClick={toggle} disabled={busy} className="btn btn-glass !py-1.5 !text-xs">
            {read ? "Mark unread" : "Mark read"}
          </button>
        </div>
      </div>
      <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-[var(--muted)]">
        {item.message}
      </p>
    </div>
  );
}
