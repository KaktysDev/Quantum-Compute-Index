import ProviderKeysManager, {
  type ProviderKeyStatus,
} from "@/components/admin/ProviderKeysManager";
import { requireAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { PROVIDER_DEFINITIONS } from "@/lib/providers";

export const dynamic = "force-dynamic";

export default async function AdminProviderKeysPage() {
  await requireAdmin();

  // provider_keys has no RLS policies (secrets) → read via the service role.
  const admin = createAdminClient();
  const { data } = await admin
    .from("provider_keys")
    .select("provider, label, enabled, updated_at");

  const byProvider = new Map((data ?? []).map((r) => [r.provider, r]));
  const providers: ProviderKeyStatus[] = PROVIDER_DEFINITIONS.map((p) => {
    const row = byProvider.get(p.id);
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      docsUrl: p.docsUrl,
      configured: Boolean(row),
      enabled: row?.enabled ?? false,
      label: row?.label ?? null,
      updatedAt: row?.updated_at ?? null,
    };
  });

  return <ProviderKeysManager providers={providers} />;
}
