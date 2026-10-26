import type { Backend } from "@/lib/qrouter/types";

/** Display only native rate evidence. Legacy catalog prices are not quotes. */
export function describeProviderPricing(backend: Backend, asOf: number) {
  const rate = backend.nativePricing;
  if (!rate || rate.kind === "unknown") return {
    known: false as const, label: "Native rate unavailable", estimate: null,
    reason: rate?.kind === "unknown" ? rate.reason : "No dated native rate is configured.",
    source: null, observedAt: null, validUntil: null, channel: null,
  };
  const observed = Date.parse(rate.observedAt);
  const expiry = Date.parse(rate.validUntil);
  const valid = Number.isFinite(observed) && observed <= asOf && Number.isFinite(expiry) && expiry > asOf
    && Number.isFinite(rate.usdPerTask) && rate.usdPerTask >= 0
    && Number.isFinite(rate.usdPerShot) && rate.usdPerShot >= 0;
  return {
    known: valid, label: valid
      ? `$${rate.usdPerTask.toFixed(3)} / task + $${rate.usdPerShot.toFixed(6)} / shot`
      : "Native rate expired or invalid",
    estimate: valid ? rate.usdPerTask + rate.usdPerShot * 1024 : null,
    reason: valid ? "Provider estimate only; software fees and retry reservations are additional." : "A fresh valid rate is required before paid routing.",
    source: rate.source, observedAt: rate.observedAt, validUntil: rate.validUntil, channel: rate.channel,
  };
}

export function pricingDate(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Unknown";
  if (Date.parse(value) >= Date.parse("9999-01-01T00:00:00Z")) return "Standing tariff";
  return new Date(value).toISOString().slice(0, 10);
}
