import type { Metadata } from "next";
import AssistantPage from "@/components/chat/AssistantPage";
import { resolveProviderLabel } from "@/lib/qrouter/providers";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "QRouter Console — Assistant" };

// The console home IS the assistant: describe a job or paste a repo URL and
// confirm the prepared run. Legacy surfaces stay one tab away in the topbar.
//
// `?route=<provider>` is how the routing tab hands a chosen provider over. It
// is resolved against the real provider list here rather than in the client, so
// a hand-edited query string can never put arbitrary text into the composer.
export default async function DashboardHomePage({
  searchParams,
}: {
  searchParams: Promise<{ route?: string }>;
}) {
  const { route } = await searchParams;
  return <AssistantPage routeProvider={resolveProviderLabel(route)} />;
}
