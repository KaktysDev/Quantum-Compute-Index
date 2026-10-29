import type { ReactNode } from "react";
import LandingNav from "./LandingNav";
import SiteFooter from "../SiteFooter";
import { technicalFont } from "./technical-font";
import "@/app/landing.css";

export default function TechnicalSite({ children }: { children: ReactNode }) {
  return (
    <div className={"qt-site " + technicalFont.variable}>
      <a className="qt-skip" href="#main-content">Skip to content</a>
      <LandingNav />
      {children}
      <SiteFooter />
    </div>
  );
}
