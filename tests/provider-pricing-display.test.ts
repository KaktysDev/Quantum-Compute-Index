import { describe, expect, it } from "vitest";
import { describeProviderPricing } from "../src/components/providers/pricing-display";
import { BACKENDS } from "../src/lib/qrouter/catalog";
import type { Backend, NativePricing } from "../src/lib/qrouter/types";

const now = Date.parse("2026-10-26T12:00:00Z");
const native: NativePricing = {
  kind: "per-shot", usdPerTask: 0.3, usdPerShot: 0.000002,
  source: "https://provider.example/rates", observedAt: "2026-10-25T12:00:00Z",
  validUntil: "2026-10-27T12:00:00Z", channel: "provider-direct",
};
const fixture = (nativePricing?: NativePricing): Backend => ({
  ...BACKENDS[0], nativePricing, pricePerShot: 0.000001, pricePerTask: 0.002, pricePerNqh: 1,
});

describe("provider price display", () => {
  it("never falls back to legacy normalized or catalog prices when native pricing is unknown", () => {
    for (const backend of [fixture(), fixture({ kind: "unknown", reason: "No current seller rate." })]) {
      const display = describeProviderPricing(backend, now);
      expect(display.known).toBe(false);
      expect(display.estimate).toBeNull();
      expect(display.label).not.toContain("$");
    }
  });

  it("keeps a valid native estimate tied to its source, dates, and execution channel", () => {
    const display = describeProviderPricing(fixture(native), now);
    expect(display.estimate).toBeCloseTo(0.302048);
    expect(display.source).toBe(native.source);
    expect(display.channel).toBe("provider-direct");
    expect(display.validUntil).toBe(native.validUntil);
    expect(display.reason).toContain("software fees and retry reservations are additional");
  });

  it("does not display expired, future-dated, or invalid rates as usable estimates", () => {
    for (const override of [
      { validUntil: "2026-10-26T12:00:00Z" },
      { observedAt: "2026-10-27T12:00:00Z" },
      { usdPerShot: -1 },
      { usdPerTask: Number.NaN },
    ]) {
      const display = describeProviderPricing(fixture({ ...native, ...override }), now);
      expect(display.known).toBe(false);
      expect(display.estimate).toBeNull();
    }
  });

  it("distinguishes an explicit zero-cost native tariff from missing pricing", () => {
    const display = describeProviderPricing(fixture({ ...native, usdPerTask: 0, usdPerShot: 0 }), now);
    expect(display.known).toBe(true);
    expect(display.estimate).toBe(0);
  });
});
