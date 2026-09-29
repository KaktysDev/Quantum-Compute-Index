import ProviderCatalog from "@/components/ProviderCatalog";
import { loadPublicRoutingContext } from "@/lib/qrouter/routingContext";

export const metadata = { title: "QRouter Console — Providers" };

// Same snapshot and health overlay the quote engine prices from, so the rates
// shown here are the rates a run is quoted at.
export default async function ProvidersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const [{ backends }, query] = await Promise.all([loadPublicRoutingContext(), searchParams]);
  return <ProviderCatalog backends={backends} initialQuery={query.q ?? ""} />;
}
