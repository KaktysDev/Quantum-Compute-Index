import AdminTabs from "@/components/admin/AdminTabs";
import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin(); // hard gate — non-admins are redirected away

  return (
    <div className="console-page">
      <div className="console-page-heading compact">
        <div>
          <h1>Admin console</h1>
        </div>
      </div>
      <AdminTabs />
      {children}
    </div>
  );
}
