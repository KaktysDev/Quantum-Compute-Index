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
