import ConsoleSubtabs from "@/components/console/ConsoleSubtabs";

// Repositories has two halves: connect a source and import projects from it,
// then deploy commit-pinned circuits from those projects. The second half used
// to live under a separate "Playground" tab, which is why it reads as its own
// page rather than another section on the import screen.
export default function RepositoriesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="console-page">
      <div className="console-page-heading compact">
        <div>
          <p className="qr-eyebrow">Source integration</p>
          <h1>Repositories</h1>
          <p>Import a GitHub repository, then run its circuits on commit-pinned source.</p>
        </div>
      </div>
      <ConsoleSubtabs
        items={[
          { href: "/dashboard/github", label: "Import", exact: true },
          { href: "/dashboard/github/deploy", label: "Deployments" },
        ]}
      />
      {children}
    </div>
  );
}
