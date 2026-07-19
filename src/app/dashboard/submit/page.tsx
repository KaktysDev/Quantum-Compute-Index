import type { Metadata } from "next";
import AssistantPage from "@/components/chat/AssistantPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "QRouter Console — Submit a task" };

// "Submit a task" is the conversational surface now: the assistant prepares
// the job and the user confirms quote + billing before anything runs.
export default function SubmitTaskPage() {
  return <AssistantPage />;
}
