import type { Metadata } from "next";
import AssistantPage from "@/components/chat/AssistantPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "QRouter Console — Assistant" };

// The console home IS the assistant: describe a job or paste a repo URL and
// confirm the prepared run. Legacy surfaces stay one tab away in the topbar.
export default function DashboardHomePage() {
  return <AssistantPage />;
}
