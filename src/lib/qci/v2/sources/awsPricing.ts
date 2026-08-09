// ──────────────────────────────────────────────────────────────────────────────
// AWS Braket price list — the index's primary price feed.
//
// This is the single most important change in v2. Every price in v1 was a
// hard-coded literal sitting in a TypeScript file:
//
//     const IBM_PRICE_PER_MIN = 96;              // ibm.ts
//     const IQM_PRICE_PER_SHOT = 0.00145;        // iqm.ts
//     rigetti: { perShot: 0.0009, ... }          // braket.ts
//
// So the index could not move on price, because no price was ever fetched. What
// actually moved it was fidelity jitter and which backends happened to answer —
// dressed up as a dollar figure.
//
// AWS publishes the Braket rate card as a versioned, machine-readable document
// with no authentication at all:
//
//   https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBraket/current/index.json
//
// It carries a `publicationDate`, so we get the seller's own effective date for
// free — exactly the `observedAt` an auditable index needs. Critically it
// includes DEDICATED RESERVATION RATES IN USD PER HOUR, which is the quantity
// the index is supposed to measure, quoted directly by the seller with no unit
// conversion and no assumption in between:
//
//   IonQ Aria-1 / Aria-2 / Forte-1 / Forte-Enterprise-1   $7,000/hr
//   Rigetti Ankaa-3                                       $5,750/hr
//   AQT IBEX-Q1                                           $4,800/hr
//   Rigetti Cepheus-1-108Q                                $4,100/hr
//   IQM Emerald                                           $4,000/hr
//   IQM Garnet                                            $3,000/hr
//   QuEra Aquila                                          $2,500/hr
//
// LIVENESS IS NOT OPTIONAL. The rate card still lists decommissioned hardware —
// five Rigetti Aspen devices, IonQ Harmony, the legacy "IonQdevice" — at their
// old, much lower per-shot prices. Ingesting the price list naively would drag
// half a dozen dead machines into the basket and crater the index. Prices from
// here are therefore only ever used for devices that the Braket control plane
// reports as live in the same run (see registry.ts).
// ──────────────────────────────────────────────────────────────────────────────

import type { Observation } from "../types";

const PRICE_LIST_URL =
  "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBraket/current/index.json";

/** AWS's published price-list document shape (only the parts we read). */
interface PriceListDocument {
  publicationDate?: string;
  version?: string;
  products?: Record<
    string,
    {
      sku?: string;
      attributes?: {
        // AWS uses TWO spellings across SKU generations. Reservation and
        // per-shot SKUs carry `provider` / `devicename`; others carry
        // `deviceProvider` / `deviceName`. Reading only one silently yields an
        // empty parse for half the rate card, so both are declared and both are
        // read — see `parseBraketPriceList`.
        deviceProvider?: string;
        provider?: string;
        deviceName?: string;
        devicename?: string;
        usagetype?: string;
        location?: string;
      };
    }
  >;
  terms?: {
    OnDemand?: Record<
      string,
      Record<
        string,
        {
          priceDimensions?: Record<
            string,
            {
              unit?: string;
              description?: string;
              pricePerUnit?: { USD?: string };
            }
          >;
        }
      >
    >;
  };
}

export interface BraketDevicePrice {
  provider: string;
  device: string;
  location: string;
  /** USD per hour of dedicated access, when AWS publishes a reservation rate. */
  perHour?: number;
  /** USD per shot. */
  perShot?: number;
  /** USD per task. */
  perTask?: number;
}

export interface BraketPriceCard {
  /** AWS's own effective date for this rate card. */
  publicationDate: string;
  version: string;
  /** Keyed by "<provider>|<device>", both lowercased. */
  devices: Map<string, BraketDevicePrice>;
}

function key(provider: string, device: string): string {
  return `${provider.trim().toLowerCase()}|${device.trim().toLowerCase()}`;
}

/**
 * Parse the price-list document into per-device rates.
 *
 * Exported separately from the fetch so it can be unit-tested against a stored
 * fixture — a price parser that silently changes shape is the kind of failure
 * that corrupts an index quietly, so it gets its own tests.
 */
export function parseBraketPriceList(doc: PriceListDocument): BraketPriceCard {
  const devices = new Map<string, BraketDevicePrice>();
  const onDemand = doc.terms?.OnDemand ?? {};

  for (const [sku, product] of Object.entries(doc.products ?? {})) {
    const attrs = product.attributes ?? {};
    // Accept both attribute spellings. The hourly RESERVATION rates — the whole
    // point of this feed — are published under the lowercase pair, so reading
    // only `deviceProvider`/`deviceName` finds every per-task price and not one
    // single $/hour rate.
    const provider = (attrs.deviceProvider ?? attrs.provider)?.trim();
    const device = (attrs.deviceName ?? attrs.devicename)?.trim();
    // Simulators and support SKUs carry no device provider — skip them.
    if (!provider || !device) continue;

    for (const offer of Object.values(onDemand[sku] ?? {})) {
      for (const dim of Object.values(offer.priceDimensions ?? {})) {
        const usd = Number(dim.pricePerUnit?.USD);
        if (!Number.isFinite(usd)) continue;
        const unit = (dim.unit ?? "").toLowerCase();
        const k = key(provider, device);
        const entry: BraketDevicePrice = devices.get(k) ?? {
          provider,
          device,
          location: attrs.location ?? "",
        };
        // AWS quotes the same rate under several usage types (plain task vs
        // hybrid-job task). They agree, so last-write-wins is safe; we key on
        // the UNIT rather than the usage type for exactly that reason.
        if (unit === "hours") entry.perHour = usd;
        else if (unit === "quantum-shot") entry.perShot = usd;
        else if (unit === "quantum-task") entry.perTask = usd;
        devices.set(k, entry);
      }
    }
  }

  return {
    publicationDate: doc.publicationDate ?? new Date().toISOString(),
    version: String(doc.version ?? "unknown"),
    devices,
  };
}

/** Fetch and parse the current Braket rate card. Throws on a failed fetch. */
export async function fetchBraketPriceCard(signal?: AbortSignal): Promise<BraketPriceCard> {
  const res = await fetch(PRICE_LIST_URL, {
    signal,
    headers: { Accept: "application/json" },
    // The rate card changes rarely; let the platform cache it for an hour so a
    // forced refresh does not re-download 450 KB each time.
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    throw new Error(`AWS Braket price list fetch failed (${res.status})`);
  }
  const doc = (await res.json()) as PriceListDocument;
  const card = parseBraketPriceList(doc);
  if (card.devices.size === 0) {
    // A structurally valid but empty parse means AWS changed the schema. Fail
    // loudly — silently returning nothing would look like a market-wide outage.
    throw new Error("AWS Braket price list parsed to zero devices — schema may have changed");
  }
  return card;
}

/** Look up one device's rates, tolerant of case and spacing. */
export function priceFor(
  card: BraketPriceCard,
  provider: string,
  device: string,
): BraketDevicePrice | undefined {
  return card.devices.get(key(provider, device));
}

/**
 * Wrap a rate-card figure as an Observation.
 *
 * `observedAt` is AWS's own publicationDate, not our fetch time — the value was
 * true from the moment AWS published it, and dating it "now" would make a
 * three-week-old rate card look freshly measured.
 *
 * `maxAgeDays` is generous (180) because a rate card is a standing offer: it
 * stays the price until the seller changes it. That is the opposite of
 * calibration data, which expires in days.
 */
export function priceObservation(
  card: BraketPriceCard,
  value: number,
  fetchedAt: string,
): Observation {
  return {
    value,
    tier: "primary",
    source: "aws.pricelist.braket",
    citation: `AWS Braket price list v${card.version} (${PRICE_LIST_URL})`,
    observedAt: card.publicationDate,
    fetchedAt,
    maxAgeDays: 180,
  };
}

export const AWS_PRICE_LIST_URL = PRICE_LIST_URL;
