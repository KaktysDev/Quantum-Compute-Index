import type { Metadata } from "next";
import ContactForm from "@/components/ContactForm";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Request Access — QRouter",
  description: "Request access to QRouter's quantum workload routing platform.",
};

export default function ContactPage() {
  return (
    <>
      <SiteHeader />
      <main className="qci-subpage relative mx-auto w-full max-w-7xl px-6 sm:px-10">
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
            QRouter is invite-only while we onboard early-access users. Tell us who you are and
            we&apos;ll be in touch.
          </p>
        </div>

        <ContactForm />
      </section>

      <SiteFooter />
      </main>
    </>
  );
}
