import type { ReactNode } from "react";
import Link from "next/link";
import LandingNav from "@/components/landing/LandingNav";
import SiteFooter from "@/components/SiteFooter";

export type LegalSection = {
  /** Anchor target. Keep these stable — other pages deep-link to them. */
  id: string;
  title: string;
  body: ReactNode;
};

export type LegalMetaItem = {
  term: string;
  detail: ReactNode;
};

/**
 * A value that cannot be derived from the codebase and must be supplied by the
 * business before these documents are published. Rendered visibly so an
 * unfilled slot is impossible to ship by accident.
 */
export function Fill({ name }: { name: string }) {
  return <mark className="legal-placeholder">[[{name}]]</mark>;
}

/** Plain-language framing that opens a dense section. */
export function Note({ children }: { children: ReactNode }) {
  return (
    <div className="legal-note">
      <p>{children}</p>
    </div>
  );
}

export default function LegalPage({
  eyebrow,
  title,
  lede,
  meta,
  sections,
}: {
  eyebrow: string;
  title: string;
  lede: ReactNode;
  meta: LegalMetaItem[];
  sections: LegalSection[];
}) {
  return (
    <>
      <LandingNav />
      <main className="legal-shell">
        <div className="legal-wrap">
          <header className="legal-header">
            <p className="legal-eyebrow">
              <i aria-hidden="true" />
              {eyebrow}
            </p>
            <h1 className="legal-title">{title}</h1>
            <p className="legal-lede">{lede}</p>
            <dl className="legal-meta">
              {meta.map((item) => (
                <div key={item.term}>
                  <dt>{item.term}</dt>
                  <dd>{item.detail}</dd>
                </div>
              ))}
            </dl>
          </header>

          <div className="legal-body">
            <nav className="legal-toc" aria-label="Sections">
              <p>Contents</p>
              <ol>
                {sections.map((section) => (
                  <li key={section.id}>
                    <a href={`#${section.id}`}>{section.title}</a>
                  </li>
                ))}
              </ol>
            </nav>

            <article className="legal-doc">
              {sections.map((section, index) => (
                <section className="legal-section" id={section.id} key={section.id}>
                  <h2>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    {section.title}
                  </h2>
                  {section.body}
                </section>
              ))}

              <div className="legal-end">
                <p>Questions about this document?</p>
                <nav aria-label="Related">
                  <Link href="/terms">Terms of Service</Link>
                  <Link href="/privacy">Privacy Policy</Link>
                  <Link href="/contact">Contact us</Link>
                  <Link href="/docs">Documentation</Link>
                </nav>
              </div>
            </article>
          </div>

          <SiteFooter />
        </div>
      </main>
    </>
  );
}
