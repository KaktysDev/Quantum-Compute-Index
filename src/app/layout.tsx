import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  // Needed so per-page canonical URLs and Open Graph assets resolve absolutely.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://qrouter.app"),
  title: "QRouter — Quantum, Where It Fits",
  description: "Explore quantum methods for your business software. Compare against classical computing and keep the evidence behind the decision.",
  openGraph: {
    title: "QRouter — Quantum, Where It Fits",
    description: "Business workloads, classical baselines and evidence you can review.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} data-scroll-behavior="smooth" suppressHydrationWarning>
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
