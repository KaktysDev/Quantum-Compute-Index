// ──────────────────────────────────────────────────────────────────────────────
// Secondary formulas from QCI Research 1.1 — documented now, wired later.
// These support the derivatives layer (futures/perps) and the ESG layer. They
// are intentionally simple, pure functions kept here so the math lives in one
// place when the trading + sustainability features are built out.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Perpetual-swap funding rate:  Funding = Premium + Interest
 * Keeps the perp's mark price aligned with the QCI spot. Positive → longs pay
 * shorts (perp trading above index); negative → shorts pay longs.
 */
export function fundingRate(premium: number, interest: number): number {
  return premium + interest;
}

/**
 * Green Software Foundation SCI for a quantum task:  SCI = (O + M) / R
 *   O = operational emissions = energy(E) × carbon intensity(I)
 *   M = embodied carbon (cryostats, superconducting chips)
 *   R = functional unit (e.g. per normalized circuit execution)
 */
export function softwareCarbonIntensity(params: {
  energyKwh: number;
  carbonIntensity: number; // gCO2e per kWh
  embodiedCarbon: number; // gCO2e attributed to this task
  functionalUnits: number; // R
}): number {
  const operational = params.energyKwh * params.carbonIntensity; // O
  if (params.functionalUnits <= 0) return 0;
  return (operational + params.embodiedCarbon) / params.functionalUnits;
}
