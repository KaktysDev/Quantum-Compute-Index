import RepositoryDeployments from "@/components/RepositoryDeployments";

export default async function PlaygroundPage({ searchParams }: { searchParams: Promise<{ target?: string }> }) {
  const { target } = await searchParams;
  return <div className="console-page deployments-page"><div className="console-page-heading compact"><div><p className="qr-eyebrow"><span /> Repository execution</p><h1>Deployments</h1><p>Send commit-pinned circuits from connected repositories through the QRouter pipeline.</p></div></div><RepositoryDeployments requestedTarget={target} /></div>;
}
