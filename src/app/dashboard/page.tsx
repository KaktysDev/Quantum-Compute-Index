import { redirect } from "next/navigation";
import { resolveProviderLabel } from "@/lib/qrouter/providers";

// `/dashboard` stays the stable post-login URL; experiments is the default and
// execution shortcuts remain available. Old provider links carrying `?route=` still
// land in Deploy with their selected target intact.
export default async function DashboardHomePage({
  searchParams,
}: {
  searchParams: Promise<{ route?: string }>;
}) {
  const { route } = await searchParams;
  const provider = resolveProviderLabel(route);
  redirect(
    provider
      ? `/dashboard/deploy?route=${encodeURIComponent(provider)}`
      : route
        ? "/dashboard/deploy"
        : "/dashboard/experiments",
  );
}
