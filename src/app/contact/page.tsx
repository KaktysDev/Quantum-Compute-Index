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
    <main className="relative mx-auto w-full max-w-7xl px-6 sm:px-10">
      <SiteHeader />
      <div className="hairline" />

      <section className="grid gap-12 py-16 lg:grid-cols-2 lg:py-24">
        <div>
          <p className="mono-label flex items-center gap-2 text-white/70">
            <span className="inline-block h-1.5 w-1.5 bg-white" />
            Contact
          </p>
          <h1 className="text-glow-strong mt-5 max-w-md text-5xl font-semibold leading-[1.02] tracking-tight text-white sm:text-6xl">
            Request access
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-[var(--muted)]">
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
