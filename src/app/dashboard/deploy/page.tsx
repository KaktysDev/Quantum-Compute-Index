import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AssistantPage from "@/components/chat/AssistantPage";
import { resolveProviderLabel } from "@/lib/qrouter/providers";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "QRouter Console — Deploy" };

export default async function DeployPage({
  searchParams,
}: {
  searchParams: Promise<{ route?: string }>;
}) {
  const { route } = await searchParams;
  const provider = resolveProviderLabel(route);
  if (route && !provider) redirect("/dashboard/deploy");
  return <AssistantPage routeProvider={provider} />;
}
