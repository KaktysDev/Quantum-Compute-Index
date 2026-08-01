import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import "./landing.css";

export const metadata: Metadata = {
  title: "QRouter — Intelligent Routing for Quantum Compute",
  description: "QRouter evaluates, compiles, prices, and intelligently routes quantum workloads across compatible backends through one API.",
  openGraph: {
    title: "QRouter — The Quantum Execution Layer",
    description: "One API for workload-specific quantum backend evaluation, routing, and execution.",
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
