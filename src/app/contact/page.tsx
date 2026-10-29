import type { Metadata } from "next";
import Image from "next/image";
import ContactForm from "@/components/ContactForm";
import TechnicalSite from "@/components/landing/TechnicalSite";

export const metadata: Metadata = {
  title: "Talk to QRouter",
  description: "Tell QRouter about your software, workload and quantum research questions.",
};
export default function ContactPage() {
  return <TechnicalSite><main id="main-content" className="qt-contact qt-page-hero qt-shell">
    <section className="qt-contact-intro"><p className="qt-eyebrow">Build with us</p><h1 className="qt-display">Bring your<br />next question.</h1><p>Tell us what your software needs to solve. We’ll discuss a sensible place to start.</p><div className="qt-contact-visual"><Image src="/landing/hero-model.webp" alt="Illustrative connected workload model" fill priority sizes="(max-width: 800px) 100vw, 45vw" /></div></section>
    <ContactForm />
  </main></TechnicalSite>;
}
