import type { Backend, CircuitAnalysis, NativePricing } from "./types";

export class PricingError extends Error {
  readonly status = 422;
  constructor(message: string, readonly code: "pricing_unavailable" | "budget_exceeded" | "requote_required" = "pricing_unavailable") {
    super(message);
    this.name = "PricingError";
  }
}

export function executionChannel(backend: Backend): string {
  if (backend.provider === "ionq") return process.env.IONQ_API_KEY ? "ionq-direct" : "aws-braket";
  if (backend.provider === "qci") return "qrouter";
  return backend.provider;
}

/** Operators must supply a dated seller rate for the exact execution channel. */
export function configuredNativePricing(backend: Backend): NativePricing {
  if (backend.provider === "qci" && backend.kind === "simulator") return {
    kind: "per-shot", usdPerShot: 0.000001, usdPerTask: 0.002,
    source: "qrouter://tariffs/simulator-v1", observedAt: "2026-09-29T00:00:00Z",
    validUntil: "9999-12-31T00:00:00Z", channel: "qrouter",
  };
  if (backend.provider === "ibm" || backend.id === "aws-sv1" || executionChannel(backend) === "ionq-direct") {
    return { kind: "unknown", reason: "This execution channel requires a provider runtime or gate-usage quote; per-shot estimates cannot price it safely." };
  }
  try {
    const config = JSON.parse(process.env.QROUTER_NATIVE_RATES_JSON ?? "{}");
    const value = config[backend.id];
    if (value?.kind === "per-shot" && Number.isFinite(value.usdPerShot) && value.usdPerShot >= 0
      && Number.isFinite(value.usdPerTask) && value.usdPerTask >= 0
      && typeof value.source === "string" && value.source.trim()
      && Number.isFinite(Date.parse(value.observedAt)) && Number.isFinite(Date.parse(value.validUntil))
      && value.channel === executionChannel(backend)) return value as NativePricing;
  } catch { /* Invalid configuration is unknown pricing, never a free quote. */ }
  return { kind: "unknown", reason: "No dated native rate is configured for this backend and execution channel." };
}

export function providerPrice(backend: Backend, shots: number, now = Date.now()): { cost: number | null; evidence: NativePricing; error?: string } {
  const evidence = backend.nativePricing ?? { kind: "unknown" as const, reason: "Native provider pricing is unknown." };
  if (evidence.kind === "unknown") return { cost: null, evidence, error: evidence.reason };
  if (!evidence.source?.trim()) return { cost: null, evidence, error: "Native pricing requires a source citation." };
  if (evidence.channel !== executionChannel(backend)) return { cost: null, evidence, error: "The rate card does not match the execution channel." };
  if (!Number.isFinite(Date.parse(evidence.observedAt)) || Date.parse(evidence.observedAt) > now
    || !Number.isFinite(Date.parse(evidence.validUntil)) || Date.parse(evidence.validUntil) <= now) {
    return { cost: null, evidence, error: "Native provider pricing is expired or has an invalid effective date." };
  }
  if (!Number.isFinite(evidence.usdPerShot) || evidence.usdPerShot < 0 || !Number.isFinite(evidence.usdPerTask) || evidence.usdPerTask < 0) {
    return { cost: null, evidence, error: "Native provider pricing contains an invalid rate." };
  }
  return { cost: evidence.usdPerTask + evidence.usdPerShot * shots, evidence };
}

export function softwareFees(analysis: CircuitAnalysis, providerBudget: number) {
  return {
    transpilerFee: 0.01 + analysis.gates * 0.00002 + analysis.twoQubitGates * 0.00008,
    platformFee: Math.max(0.005, providerBudget * 0.08),
  };
}

export function totalPrice(analysis: CircuitAnalysis, providerBudget: number) {
  const fees = softwareFees(analysis, providerBudget);
  return providerBudget + fees.transpilerFee + fees.platformFee;
}
