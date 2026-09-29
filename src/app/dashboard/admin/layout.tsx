import AdminTabs from "@/components/admin/AdminTabs";
import { PageHeader } from "@/components/console/ui";
import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin(); // hard gate: non-admins are redirected away

  return (
    <div className="console-page wide">
      <PageHeader title="Admin" description="Platform-wide data across every workspace." />
      <AdminTabs />
      {children}
    </div>
  );
}
