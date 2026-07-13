import ProviderCatalog from "@/components/ProviderCatalog";
import { getLatestSnapshot } from "@/lib/qci/store";
import { withQciSnapshot } from "@/lib/qrouter/catalog";

export default async function ProvidersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const [latest, query] = await Promise.all([getLatestSnapshot(), searchParams]);
  return <ProviderCatalog backends={withQciSnapshot(latest.components)} initialQuery={query.q ?? ""} />;
}
