import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QRouter — One API for quantum compute",
  description:
    "Transpile, route, and run quantum workloads across every major provider with one API key.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <div className="curtain" />
        {children}
      </body>
    </html>
  );
}
