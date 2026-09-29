import RepositoryDeployments from "@/components/RepositoryDeployments";

// Was /dashboard/playground. Deploying from a repository belongs next to the
// repositories themselves, not in a separate top-level tab.
export const metadata = { title: "QRouter Console — Deployments" };

export default async function RepositoryDeployPage({
  searchParams,
}: {
  searchParams: Promise<{ target?: string }>;
}) {
  const { target } = await searchParams;
  return (
    <div className="deployments-page">
      <RepositoryDeployments requestedTarget={target} />
    </div>
  );
}
