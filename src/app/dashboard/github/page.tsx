import GitHubManager from "@/components/GitHubManager";

// Heading and sub-tabs live in the layout; this is just the import surface.
export const metadata = { title: "QRouter Console — Repositories" };

export default function GitHubPage() {
  return <GitHubManager />;
}
