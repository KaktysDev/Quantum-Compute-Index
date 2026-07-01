import type { Metadata } from "next";
import ContactForm from "@/components/ContactForm";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Request access — QuantumForge",
  description: "Request access to QuantumForge Exchange.",
};

export default function ContactPage() {
  return (
    <main className="qci-subpage relative mx-auto w-full max-w-7xl px-6 sm:px-10">
      <SiteHeader />
      <div className="hairline" />

      <section className="qci-subpage-hero grid gap-12 py-16 lg:grid-cols-2 lg:py-24">
        <div>
          <p className="mono-label flex items-center gap-2 text-white/70">
            <span className="inline-block h-1.5 w-1.5 bg-white" />
            Contact
          </p>
          <h1 className="qci-subpage-title mt-5 max-w-md text-white">
            Request access
          </h1>
          <p className="qci-subpage-lede mt-6 max-w-md">
            QuantumForge is invite-only while we onboard our first partners. Tell us who you are and
            we&apos;ll be in touch.
          </p>
        </div>

        <ContactForm />
      </section>

      <SiteFooter />
    </main>
  );
}
