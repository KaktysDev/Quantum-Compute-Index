import { describe, expect, it } from "vitest";

import { capitalRecoveryFactor, deviceCost } from "@/lib/qci/v2/cost";
import { computeIndexPoint } from "@/lib/qci/v2/compute";
import { reconcileLedger, type LedgerEntry } from "@/lib/qci/v2/ledger";
import { capability, effectiveWidth } from "@/lib/qci/v2/quality";
import { parseBraketPriceList } from "@/lib/qci/v2/sources/awsPricing";
import { capWeights, linkPeriod, weightedGeoMean } from "@/lib/qci/v2/tornqvist";
import type { DeviceObservation, FactorObservation, Observation } from "@/lib/qci/v2/types";

// ── helpers ───────────────────────────────────────────────────────────────────

function o(value: number, over: Partial<Observation> = {}): Observation {
  return {
    value,
    tier: "primary",
    source: "test",
    observedAt: "2026-08-09T00:00:00Z",
    fetchedAt: "2026-08-09T00:00:00Z",
    maxAgeDays: 30,
    ...over,
  };
}

function device(
  id: string,
  provider: string,
  pricePerHour: number,
  qubits = 32,
  twoQubitError = 0.005,
): DeviceObservation {
  return {
    id,
    provider,
    device: id.split(":")[1] ?? id,
    modality: "superconducting",
    region: "us-east-1",
    usState: "NY",
    pricePerHour: o(pricePerHour),
    priceBasis: "reservation-hour",
    qubits: o(qubits),
    twoQubitError: o(twoQubitError),
    layerRate: o(1000, { tier: "assumed" }),
    online: { ...o(1), value: true } as unknown as Observation<boolean>,
  };
}

/** Run n consecutive days and return the published levels. */
function runDays(days: DeviceObservation[][], factors: FactorObservation[] = []) {
  let ledger = new Map<string, LedgerEntry>();
  let level: number | null = null;
  const points = [];
  const start = Date.UTC(2026, 0, 1);
  for (let i = 0; i < days.length; i++) {
    const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    const out = computeIndexPoint({
      observations: days[i],
      factors,
      previousLedger: ledger,
      previousLevel: level,
      today: date,
    });
    ledger = out.ledger;
    level = out.point.level;
    points.push(out.point);
  }
  return points;
}

// ── the defect this rewrite exists to fix ─────────────────────────────────────

describe("offline constituents cannot move the index", () => {
  it("a device going dark produces exactly zero index change", () => {
    const full = [
      device("a:one", "A", 7000),
      device("b:two", "B", 3000),
      device("c:three", "C", 2500),
    ];
    // Day 1 links everything in. Day 2 establishes a baseline. Day 3 loses a
    // device entirely, with the survivors' prices unchanged.
    const points = runDays([full, full, [full[0], full[1]]]);

    expect(points[2].changePct).toBe(0);
    expect(points[2].level).toBeCloseTo(points[1].level, 10);
    // …and the loss is reported rather than hidden.
    expect(points[2].excluded.some((e) => e.id === "c:three")).toBe(true);
    expect(points[2].coverage).toBeLessThan(1);
  });

  it("v1's failure mode: dropping the cheapest device would have spiked a plain average", () => {
    const full = [
      device("a:one", "A", 7000),
      device("b:two", "B", 3000),
      device("c:three", "C", 2500),
    ];
    const naiveBefore = (7000 + 3000 + 2500) / 3;
    const naiveAfter = (7000 + 3000) / 2;
    // A plain mean jumps 17% purely from composition — this is the artefact.
    expect((naiveAfter / naiveBefore - 1) * 100).toBeGreaterThan(15);

    const points = runDays([full, full, [full[0], full[1]]]);
    expect(points[2].changePct).toBe(0);
  });

  it("a device coming back after an outage does not dump its drift into one day", () => {
    const a = device("a:one", "A", 7000);
    const b = device("b:two", "B", 3000);
    const bMuchCheaper = device("b:two", "B", 1500);
    // b vanishes on day 3, returns on day 4 at half price.
    const points = runDays([[a, b], [a, b], [a], [a, bMuchCheaper]]);

    // Re-entry links in the new level without linking the change.
    expect(points[3].changePct).toBe(0);
    // The unlinked amount is recorded, not silently discarded.
    const relinked = points[3].excluded.find((e) => e.id === "b:two");
    expect(relinked?.reason).toBe("reentry-cooldown");
  });

  it("a new provider joining the basket does not reprice the index", () => {
    const a = device("a:one", "A", 7000);
    const b = device("b:two", "B", 3000);
    const newcomer = device("z:new", "Z", 100); // wildly cheaper
    const points = runDays([[a, b], [a, b], [a, b, newcomer]]);
    expect(points[2].changePct).toBe(0);
  });
});

// ── the index does still move on real price changes ───────────────────────────

describe("genuine price moves are captured", () => {
  it("a uniform 10% price cut moves the index by −10%", () => {
    const day1 = [device("a:one", "A", 7000), device("b:two", "B", 3000)];
    const day3 = [device("a:one", "A", 6300), device("b:two", "B", 2700)];
    const points = runDays([day1, day1, day3]);
    expect(points[2].changePct).toBeCloseTo(-10, 6);
  });

  it("a quality improvement at constant price lowers the quality-adjusted index", () => {
    // Same $/hour, but the error rate halves → wider usable circuits.
    const before = [device("a:one", "A", 5000, 64, 0.008)];
    const after = [device("a:one", "A", 5000, 64, 0.004)];
    // The ledger smooths quality with a trailing median, so hold the improved
    // value long enough for the median to move.
    const points = runDays([before, before, after, after, after, after, after, after]);
    const last = points.at(-1)!;
    expect(last.level).toBeLessThan(points[1].level);
    // The headline USD/hour is unchanged; only the quality-adjusted price moved.
    expect(last.usdPerQpuHour).toBeCloseTo(5000, 6);
  });

  it("price and quality contributions sum exactly to the total move", () => {
    const day1 = [device("a:one", "A", 7000, 64, 0.008), device("b:two", "B", 3000, 32, 0.005)];
    const day3 = [device("a:one", "A", 7700, 64, 0.008), device("b:two", "B", 2700, 32, 0.005)];
    const points = runDays([day1, day1, day3]);
    const a = points[2].attribution;
    expect(a.priceLogChange + a.qualityLogChange).toBeCloseTo(a.totalLogChange, 12);
    const summed = a.byDevice.reduce((s, d) => s + d.contribution, 0);
    expect(summed).toBeCloseTo(a.totalLogChange, 12);
  });
});

// ── data-quality controls ─────────────────────────────────────────────────────

describe("large-move verification", () => {
  it("holds an unconfirmed spike, then accepts it when it reproduces", () => {
    const normal = [device("a:one", "A", 5000), device("b:two", "B", 3000)];
    // A 40% jump on one device: held on first sight.
    const spike = [device("a:one", "A", 7000), device("b:two", "B", 3000)];
    const points = runDays([normal, normal, spike, spike]);

    expect(points[2].changePct).toBe(0); // held — no move
    expect(points[3].changePct).toBeGreaterThan(0); // corroborated — lands
  });

  it("a one-off bad value never enters the index at all", () => {
    const normal = [device("a:one", "A", 5000), device("b:two", "B", 3000)];
    const glitch = [device("a:one", "A", 0.5), device("b:two", "B", 3000)];
    const points = runDays([normal, normal, glitch, normal]);
    expect(points[2].changePct).toBe(0);
    expect(points[3].changePct).toBe(0);
    expect(points[3].level).toBeCloseTo(points[1].level, 10);
  });

  it("an implausible calibration reading is ignored rather than trusted", () => {
    const good = device("a:one", "A", 5000, 64, 0.005);
    const bogus = device("a:one", "A", 5000, 64, 0.99); // outside the valid band
    const ledger = new Map<string, LedgerEntry>();
    const first = reconcileLedger({ observations: [good], previous: ledger, today: "2026-08-01" });
    const second = reconcileLedger({
      observations: [bogus],
      previous: first.ledger,
      today: "2026-08-02",
    });
    // The bad reading is not appended to the smoothing history.
    expect(second.ledger.get("a:one")!.errorHistory).toEqual([0.005]);
  });

  it("retires a device that stays dark past the staleness limit", () => {
    const a = device("a:one", "A", 5000);
    const b = device("b:two", "B", 3000);
    let ledger = new Map<string, LedgerEntry>();
    let out = reconcileLedger({ observations: [a, b], previous: ledger, today: "2026-01-01" });
    ledger = out.ledger;
    for (let i = 1; i <= 46; i++) {
      out = reconcileLedger({
        observations: [a],
        previous: ledger,
        today: `2026-03-${String(i).padStart(2, "0")}`,
      });
      ledger = out.ledger;
    }
    expect(out.retired).toContain("b:two");
    expect(ledger.get("b:two")!.state).toBe("retired");
  });
});

// ── aggregation mechanics ─────────────────────────────────────────────────────

describe("weight capping", () => {
  it("caps a dominant provider and redistributes the excess", () => {
    const raw = [
      { id: "1", provider: "IonQ", share: 7000 },
      { id: "2", provider: "IonQ", share: 7000 },
      { id: "3", provider: "IonQ", share: 7000 },
      { id: "4", provider: "IonQ", share: 7000 },
      { id: "5", provider: "QuEra", share: 2500 },
      { id: "6", provider: "IQM", share: 3000 },
    ];
    const w = capWeights(raw);
    const ionq = ["1", "2", "3", "4"].reduce((a, id) => a + w.get(id)!, 0);
    expect(ionq).toBeLessThanOrEqual(0.4 + 1e-9);
    const total = [...w.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("never lets one device exceed the device cap", () => {
    const raw = [
      { id: "1", provider: "A", share: 1_000_000 },
      { id: "2", provider: "B", share: 1 },
      { id: "3", provider: "C", share: 1 },
      { id: "4", provider: "D", share: 1 },
      { id: "5", provider: "E", share: 1 },
    ];
    const w = capWeights(raw);
    expect(w.get("1")!).toBeLessThanOrEqual(0.25 + 1e-9);
  });

  it("falls back to equal weights on degenerate input rather than dividing by zero", () => {
    const w = capWeights([
      { id: "1", provider: "A", share: 0 },
      { id: "2", provider: "B", share: 0 },
    ]);
    expect(w.get("1")).toBeCloseTo(0.5, 12);
  });
});

describe("link mechanics", () => {
  it("an empty matched sample produces no movement, not a crash", () => {
    const r = linkPeriod([]);
    expect(r.logChange).toBe(0);
    expect(r.contributions).toHaveLength(0);
  });

  it("rejects non-positive prices from the log domain", () => {
    const r = linkPeriod([
      {
        id: "x",
        provider: "X",
        prevPrice: 0,
        currPrice: 5,
        prevHeadline: 0,
        currHeadline: 5,
        prevShare: 1,
        currShare: 1,
      },
    ]);
    expect(r.logChange).toBe(0);
  });

  it("weighted geometric mean matches the closed form", () => {
    const w = new Map([
      ["a", 0.5],
      ["b", 0.5],
    ]);
    const g = weightedGeoMean(
      [
        { id: "a", value: 4 },
        { id: "b", value: 9 },
      ],
      w,
    );
    expect(g).toBeCloseTo(6, 10); // sqrt(4·9)
  });
});

// ── quality model ─────────────────────────────────────────────────────────────

describe("hedonic quality", () => {
  it("effective width is limited by error rate when qubits are plentiful", () => {
    // sqrt(2/0.005) ≈ 20 → error-limited well below the 156 physical qubits.
    expect(effectiveWidth(156, 0.005)).toBe(20);
  });

  it("effective width is limited by qubit count when fidelity is high", () => {
    expect(effectiveWidth(20, 0.0001)).toBe(20);
  });

  it("survives absurd inputs without producing Infinity or NaN", () => {
    expect(Number.isFinite(effectiveWidth(0, 0))).toBe(true);
    expect(effectiveWidth(0, 0)).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(capability(effectiveWidth(-5, 2), 0))).toBe(true);
  });

  it("capability rises with width and with speed", () => {
    expect(capability(30, 1000)).toBeGreaterThan(capability(15, 1000));
    expect(capability(15, 2000)).toBeGreaterThan(capability(15, 1000));
  });
});

// ── cost model ────────────────────────────────────────────────────────────────

describe("cost basis", () => {
  it("capital recovery factor matches the standard annuity formula", () => {
    // r=4.2%, n=5 → 0.042·1.042^5 / (1.042^5 − 1) = 0.051593 / 0.228402
    expect(capitalRecoveryFactor(0.042, 5)).toBeCloseTo(0.225891, 5);
    expect(capitalRecoveryFactor(0, 5)).toBeCloseTo(0.2, 10);
  });

  it("capital dominates and energy is a rounding error — the headline finding", () => {
    const c = deviceCost({ modality: "superconducting", usState: "NY" }, []);
    // Capital recovery alone is the largest single term…
    expect(c.shares.capital).toBeGreaterThan(0.65);
    // …and everything except energy traces back to capex, so the machine and
    // its utilisation account for essentially all of the cost.
    expect(c.shares.capital + c.shares.labour + c.shares.consumables).toBeGreaterThan(0.99);
    expect(c.shares.energy).toBeLessThan(0.01);
    // A 25 kW system at ~8c/kWh really is a couple of dollars an hour.
    expect(c.energy).toBeGreaterThan(1);
    expect(c.energy).toBeLessThan(10);
  });

  it("energy elasticity equals the energy share exactly", () => {
    const c = deviceCost({ modality: "superconducting", usState: "NY" }, []);
    expect(c.energyElasticity).toBeCloseTo(c.shares.energy, 12);
    // Doubling electricity moves modelled cost by well under 1%.
    expect(c.energyElasticity).toBeLessThan(0.01);
  });

  it("shares sum to one", () => {
    const c = deviceCost({ modality: "trapped-ion", usState: "MD" }, []);
    const s = c.shares;
    expect(s.energy + s.consumables + s.labour + s.capital).toBeCloseTo(1, 12);
  });
});

// ── price feed parsing ────────────────────────────────────────────────────────

describe("AWS Braket price list parser", () => {
  const fixture = {
    publicationDate: "2026-04-07T18:45:08Z",
    version: "20260407184508",
    products: {
      // NOTE: the real feed publishes reservation and per-shot SKUs under
      // `provider`/`devicename` (lowercase) while other SKUs use
      // `deviceProvider`/`deviceName`. The fixture reproduces BOTH spellings
      // because an earlier parser read only the camelCase pair and therefore
      // found zero hourly rates against the live rate card while passing its
      // own tests.
      SKU_RES: {
        attributes: {
          provider: "IonQ",
          devicename: "Aria-1",
          usagetype: "USE1-Reservation-IonQ-Aria-1",
          location: "US East (N. Virginia)",
        },
      },
      SKU_SHOT: {
        attributes: {
          provider: "IonQ",
          devicename: "Aria-1",
          usagetype: "USE1-Task-Shot-IonQ-Aria-1",
          location: "US East (N. Virginia)",
        },
      },
      SKU_TASK: {
        attributes: {
          deviceProvider: "IonQ",
          deviceName: "Aria-1",
          usagetype: "USE1-Task-IonQ-Aria-1",
          location: "US East (N. Virginia)",
        },
      },
      SKU_SIM: { attributes: { usagetype: "USE1-SimulatorTask" } },
    },
    terms: {
      OnDemand: {
        SKU_RES: {
          o1: { priceDimensions: { d1: { unit: "hours", pricePerUnit: { USD: "7000.0000" } } } },
        },
        SKU_SHOT: {
          o1: {
            priceDimensions: { d1: { unit: "Quantum-Shot", pricePerUnit: { USD: "0.0300000" } } },
          },
        },
        SKU_TASK: {
          o1: {
            priceDimensions: { d1: { unit: "Quantum-Task", pricePerUnit: { USD: "0.3000" } } },
          },
        },
      },
    },
  };

  it("extracts the hourly reservation rate", () => {
    const card = parseBraketPriceList(fixture);
    expect(card.devices.get("ionq|aria-1")?.perHour).toBe(7000);
    expect(card.devices.get("ionq|aria-1")?.perShot).toBe(0.03);
  });

  it("reads BOTH attribute spellings AWS publishes", () => {
    const card = parseBraketPriceList(fixture);
    const d = card.devices.get("ionq|aria-1");
    // perHour/perShot come from the lowercase pair, perTask from the camelCase
    // pair — all three must land on one device record.
    expect(d?.perHour).toBe(7000);
    expect(d?.perTask).toBe(0.3);
  });

  it("uses AWS's publication date as the effective date, not fetch time", () => {
    expect(parseBraketPriceList(fixture).publicationDate).toBe("2026-04-07T18:45:08Z");
  });

  it("ignores SKUs with no device attribution", () => {
    expect(parseBraketPriceList(fixture).devices.size).toBe(1);
  });
});

// ── published disclosures ─────────────────────────────────────────────────────

describe("index disclosures", () => {
  it("marks a thin day provisional and a full day final", () => {
    const full = [
      device("a:one", "A", 7000),
      device("b:two", "B", 3000),
      device("c:three", "C", 2500),
    ];
    const points = runDays([full, full, [full[2]]]);
    expect(points[1].status).toBe("final");
    expect(points[2].status).toBe("provisional");
    expect(points[2].coverage).toBeLessThan(0.6);
  });

  it("anchors the first point to 1000", () => {
    const points = runDays([[device("a:one", "A", 5000)]]);
    expect(points[0].level).toBe(1000);
  });

  it("keeps full precision in the level so the chain does not drift", () => {
    // v1 rounded to 2dp and fed that back in; over many small moves that
    // compounds. Here a long run of tiny alternating moves must return home.
    const days: DeviceObservation[][] = [];
    for (let i = 0; i < 60; i++) {
      days.push([device("a:one", "A", i % 2 === 0 ? 5000 : 5001)]);
    }
    const points = runDays(days);
    expect(points.at(-1)!.level).toBeCloseTo(points[1].level, 6);
  });
});

// ── the cross-section vs the chain ────────────────────────────────────────────
// The published level may only move on the matched sample. The headline price,
// the cost basis and the map's node sizes describe TODAY'S basket instead, so
// they must be computable on a day when nothing is matched — which is every
// first day, every full-basket outage, and every forced re-run of day one.

describe("headline price on a day with no matched sample", () => {
  const basket = [
    device("a:one", "A", 7000),
    device("b:two", "B", 3000),
    device("c:three", "C", 2500),
  ];

  it("publishes a real price on the very first point", () => {
    const [first] = runDays([basket]);
    expect(first.matched).toBe(0);
    expect(first.coverage).toBe(0);
    expect(first.level).toBe(1000);
    // The whole defect: this used to be 0, so the tab rendered a $0 index.
    expect(first.usdPerQpuHour).toBeGreaterThan(2500);
    expect(first.usdPerQpuHour).toBeLessThan(7000);
    expect(first.usdPerQcu).toBeGreaterThan(0);
    expect(first.priced).toBe(3);
  });

  it("flags the first point as inception rather than as a coverage failure", () => {
    const points = runDays([basket, basket]);
    expect(points[0].inception).toBe(true);
    expect(points[1].inception).toBe(false);
  });

  it("sizes every device on day one, so the map is not a ring of zeroes", () => {
    const [first] = runDays([basket]);
    expect(first.devices.every((d) => d.weight > 0)).toBe(true);
    // ...while contributing nothing to the move.
    expect(first.devices.every((d) => d.linkWeight === 0)).toBe(true);
  });

  it("counts a device measured today as fresh even before it can be linked", () => {
    const [first] = runDays([basket]);
    expect(first.devices.every((d) => d.fresh)).toBe(true);
    expect(first.devices.every((d) => !d.inMatchedSample)).toBe(true);
  });

  it("produces a cost basis and its components on day one", () => {
    const [first] = runDays([basket]);
    expect(first.costBasisPerHour).toBeGreaterThan(0);
    expect(first.costComponents?.capital).toBeGreaterThan(0);
    expect(first.costCoverageRatio).toBeGreaterThan(0);
  });

  it("still refuses to let a new constituent move the LEVEL", () => {
    // The guarantee the cross-section must not weaken: adding a cheap device
    // drags the headline cross-section down, and leaves the tracked series
    // untouched.
    const points = runDays([basket, basket, [...basket, device("d:four", "D", 500)]]);
    expect(points[2].level).toBeCloseTo(points[1].level, 12);
    expect(points[2].changePct).toBeCloseTo(0, 12);
    expect(points[2].usdPerQpuHour).toBeLessThan(points[1].usdPerQpuHour);
  });
});

describe("one device reported by two feeds", () => {
  it("merges field-by-field, keeping whichever source measured each field", async () => {
    const { dedupeObservations } = await import("@/lib/qci/v2/collect");

    // Braket knows the real qubit count but publishes no calibration; the
    // vendor's own cloud measures the error but mis-reports the lattice size.
    const viaBraket = device("iqm:emerald", "IQM", 4000, 54, 0.012);
    viaBraket.qubits = o(54, { source: "provider.braket" });
    viaBraket.twoQubitError = o(0.012, { tier: "assumed", source: "provider.braket.calibration" });
    viaBraket.mergedFrom = ["braket"];

    const viaVendor = device("iqm:emerald", "IQM", 4000, 20, 0.0016);
    viaVendor.qubits = o(20, { tier: "assumed", source: "provider.iqm" });
    viaVendor.twoQubitError = o(0.0016, { source: "provider.iqm.calibration" });
    viaVendor.mergedFrom = ["iqm"];

    const { observations, merged } = dedupeObservations([viaBraket, viaVendor]);

    expect(observations).toHaveLength(1);
    expect(observations[0].qubits.value).toBe(54); // measured, from Braket
    expect(observations[0].twoQubitError.value).toBe(0.0016); // measured, from IQM
    expect(observations[0].mergedFrom).toEqual(["braket", "iqm"]);
    expect(merged).toEqual([{ id: "iqm:emerald", sources: ["braket", "iqm"] }]);
  });

  it("leaves a single-feed device untouched and reports no merge", async () => {
    const { dedupeObservations } = await import("@/lib/qci/v2/collect");
    const only = device("a:one", "A", 7000);
    const { observations, merged } = dedupeObservations([only]);
    expect(observations).toEqual([only]);
    expect(merged).toEqual([]);
  });

  it("treats a device as down when any feed reports it down", async () => {
    const { dedupeObservations } = await import("@/lib/qci/v2/collect");
    const up = device("a:one", "A", 7000);
    const down = device("a:one", "A", 7000);
    down.online = { ...down.online, value: false };
    expect(dedupeObservations([up, down]).observations[0].online.value).toBe(false);
    expect(dedupeObservations([down, up]).observations[0].online.value).toBe(false);
  });
});
