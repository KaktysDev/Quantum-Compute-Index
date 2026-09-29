import { describe, expect, it } from "vitest";
import { chargedFromLedger, costText, costView, formatUsd } from "@/lib/qrouter/cost";

describe("job cost display", () => {
  it("derives the billed amount from ledger charge rows", () => {
    expect(chargedFromLedger([{ type: "charge", amount: -0.42 }])).toBeCloseTo(0.42);
    expect(chargedFromLedger([{ type: "release", amount: 0.5 }])).toBeNull();
    expect(chargedFromLedger([{ type: "charge", amount: "-1.2" }, { type: "refund", amount: 0.2 }])).toBeCloseTo(1);
    expect(chargedFromLedger(null)).toBeNull();
  });

  it("shows the charge, and the quote only when it differs", () => {
    expect(costView({ status: "completed", quoted: 1, charged: 1 })).toEqual({ label: "Charged", amount: 1 });
    expect(costView({ status: "completed", quoted: 1, charged: 0.6 })).toEqual({ label: "Charged", amount: 0.6, secondary: "quoted $1.00" });
    expect(costView({ status: "completed", quoted: 0.5, charged: 0.25 }).secondary).toBe("quoted $0.50");
  });

  it("never claims a charge for jobs that did not complete", () => {
    expect(costView({ status: "failed", quoted: 1, charged: null }).label).toBe("Not charged");
    expect(costView({ status: "cancelled", quoted: 1, charged: null }).amount).toBeNull();
  });

  it("distinguishes reserved, parked and quoted money", () => {
    expect(costView({ status: "queued", quoted: 2, charged: null })).toEqual({ label: "Reserved", amount: 2 });
    expect(costView({ status: "awaiting_payment", quoted: 2, charged: null })).toEqual({ label: "Needs", amount: 2 });
    expect(costView({ status: "quoted", quoted: 2, charged: null })).toEqual({ label: "Quoted", amount: 2 });
    expect(costText(costView({ status: "processing", quoted: null, charged: null }))).toBe("Pricing");
  });

  it("keeps sub-cent amounts visible", () => {
    expect(formatUsd(0.0042)).toBe("$0.0042");
    expect(formatUsd(0.0177)).toBe("$0.0177");
    expect(formatUsd(0.25)).toBe("$0.25");
    expect(formatUsd(0.5)).toBe("$0.50");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(12.4)).toBe("$12.40");
  });
});
