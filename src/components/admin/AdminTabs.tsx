"use client";

import { Tabs } from "@/components/console/ui";

const TABS = [
  { href: "/dashboard/admin/overview", label: "Overview" },
  { href: "/dashboard/admin/users", label: "Users" },
  { href: "/dashboard/admin/access", label: "Access" },
  { href: "/dashboard/admin/reports", label: "Reports" },
  { href: "/dashboard/admin/provider-keys", label: "Provider keys" },
  { href: "/dashboard/admin/health", label: "Health" },
];

export default function AdminTabs() {
  return <Tabs items={TABS} label="Admin sections" />;
}
