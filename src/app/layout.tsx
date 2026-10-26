import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  // Needed so per-page canonical URLs and Open Graph assets resolve absolutely.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://qrouter.app"),
  title: "QRouter — Quantum Experiments You Can Review",
  description: "Plan private quantum experiments, approve a budget, and keep inputs, execution records, and result evidence together.",
  openGraph: {
    title: "QRouter — Quantum Experiments You Can Review",
    description: "A reviewable workflow for quantum experiments and their evidence.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        {/* Replay the saved appearance choice before first paint, so switching
            themes never flashes the previous one. Light is the default. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("qrouter-theme");document.documentElement.setAttribute("data-theme",t==="dark"?"dark":"light")}catch(e){}`,
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <div className="curtain" />
        {children}
      </body>
    </html>
  );
}
