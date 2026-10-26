import ProviderCatalog from "@/components/ProviderCatalog";
import { loadPublicRoutingContext } from "@/lib/qrouter/routingContext";

export default async function ProvidersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const [{ backends }, query] = await Promise.all([loadPublicRoutingContext(), searchParams]);
  return <ProviderCatalog backends={backends} asOf={Date.now()} initialQuery={query.q ?? ""} />;
}
