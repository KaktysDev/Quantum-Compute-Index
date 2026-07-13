import GitHubManager from "@/components/GitHubManager";

export default function GitHubPage() {
  return <div className="console-page"><div className="console-page-heading compact"><div><p className="qr-eyebrow">Source integration</p><h1>GitHub</h1><p>Connect a repository to prepare source-triggered quantum workflows.</p></div></div><GitHubManager /></div>;
}
