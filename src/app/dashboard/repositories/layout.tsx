import { PageHeader, Tabs } from "@/components/console/ui";

// Import connects a source and adds projects; Deployments runs commit-pinned
// circuits from those projects.
export default function RepositoriesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="console-page">
      <PageHeader
        title="Repositories"
        description="Import OpenQASM entrypoints from GitHub and deploy them at a pinned commit."
      />
      <Tabs
        items={[
          { href: "/dashboard/repositories", label: "Import", exact: true },
          { href: "/dashboard/repositories/deployments", label: "Deployments" },
        ]}
      />
      {children}
    </div>
  );
}
