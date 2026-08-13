import Link from "next/link";
import { ArrowLeft, FlaskConical } from "lucide-react";
import QciMap from "@/components/QciMap";
import { collectDryRun } from "@/lib/qci/v2/collect";
import { computeIndexPoint } from "@/lib/qci/v2/compute";
import type { LedgerEntry } from "@/lib/qci/v2/ledger";
import { REGISTRY, requiredEnergyRegions } from "@/lib/qci/v2/registry";
import { collectFactors } from "@/lib/qci/v2/sources/factors";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Dry-run preview of the attribution map.
 *
 * Computes a live index point from the public AWS rate card, the live macro
 * factor feeds, and each device's published reference spec — writing nothing.
 * It exists so the map and any methodology change can be inspected before
 * provider credentials are configured or the v2 migration is applied.
 *
 * Everything here is clearly labelled as a dry run. It shares no code path with
 * the published index beyond the pure computation itself.
 */
export default async function QciPreviewPage() {
  const [collected, factors] = await Promise.all([
    collectDryRun(),
    collectFactors(requiredEnergyRegions(REGISTRY)),
  ]);

  // Three periods: the first links every device in, the second establishes the
  // baseline, the third is the published point. A device only contributes from
  // its second observation onward, so a single pass would produce an empty
  // matched sample.
  let ledger = new Map<string, LedgerEntry>();
  let level: number | null = null;
  let point = null;
  for (let d = 0; d < 3; d++) {
    const date = new Date(Date.now() - (2 - d) * 86_400_000).toISOString().slice(0, 10);
    const out = computeIndexPoint({
      observations: collected.observations,
      factors,
      previousLedger: ledger,
      previousLevel: level,
      today: date,
    });
    ledger = out.ledger;
    level = out.point.level;
    point = out.point;
  }

  return (
    <div className="console-page">
      <div className="console-page-heading">
        <div>
          <h1>Index preview</h1>
          {/* This one stays: it is the only thing distinguishing a dry run from
              the live index, which is a distinction worth a sentence. */}
          <p>Computed live from the Braket rate card and macro feeds. Nothing here is written or published.</p>
        </div>
        <Link href="/dashboard/qci" className="console-primary">
          <ArrowLeft size={14} /> Back to QCI
        </Link>
      </div>

      <div className="console-note">
        <strong>
          <FlaskConical size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} />
          Dry run.
        </strong>{" "}
        Prices are real — AWS price list{" "}
        <code>v{collected.priceCardVersion ?? "unavailable"}</code>, published{" "}
        {collected.priceCardDate?.slice(0, 10) ?? "—"}. Hardware quality metrics come from published
        reference specifications rather than live provider telemetry, so the quality-adjusted figures
        are indicative. The published index only ever uses metrics an operator reported live.
        {collected.unpriced.length > 0 ? (
          <>
            {" "}
            No published hourly rate for: <code>{collected.unpriced.join(", ")}</code>.
          </>
        ) : null}
      </div>

      {point ? (
        <QciMap point={point} />
      ) : (
        <section className="console-panel">
          <div className="qci-empty">
            <h3>Could not compute a preview</h3>
            <p>
              The AWS Braket price list could not be reached, so no device has a published hourly
              rate to price.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
