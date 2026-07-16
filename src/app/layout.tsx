import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

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
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body suppressHydrationWarning>
        {/* No-flash theme restore: runs synchronously before the page paints,
            so a returning dark-mode user never sees a bright frame. The saved
            profile preference re-syncs this after login (see ThemeSync). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("qr-theme")==="dark")document.documentElement.setAttribute("data-theme","dark")}catch(e){}`,
          }}
        />
        <div className="curtain" />
        {children}
      </body>
    </html>
  );
}
