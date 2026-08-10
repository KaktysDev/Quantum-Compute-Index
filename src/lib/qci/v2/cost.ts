// ──────────────────────────────────────────────────────────────────────────────
// Bottom-up cost basis of one QPU-hour.
//
// This is the companion series that answers "WHY does a quantum hour cost what
// it costs, and what would move it?" — the question the old index could not
// address at all, because it had no cost side.
//
// It is deliberately NOT part of the headline index. A price index measures
// prices; folding modelled costs into it would make the number a blend of an
// observation and a forecast, and no reader could tell which had moved. What
// the two series together give you is the ratio between them, which is the
// genuinely informative quantity.
//
//     C_hour = energy + consumables + labour + capital recovery
//
//     energy       = powerKW × PUE × electricity price   (live, regional)
//     consumables  = capex × consumablesRate / billable hours   (cryogens, optics)
//     labour       = capex × labourRate      / billable hours
//     capital      = capex × CRF(r, n)       / billable hours
//
//     CRF(r, n) = r(1+r)^n / ((1+r)^n − 1)      standard capital recovery factor
//
// WHAT THE NUMBERS ACTUALLY SAY
// Run the model on a superconducting device ($22M capex, 5-year life, 50%
// billable utilisation, 25 kW at ~8.3c/kWh) and the shares are not close:
//
//     capital recovery  ~$1,135 /hr        71%  of modelled cost
//     labour            ~$301  /hr         19%
//     consumables       ~$151  /hr          9%   (cryogens, optics, spares)
//     energy            ~$3.13 /hr          0.2%
//     ─────────────────────────────────────────
//     total             ~$1,590 /hr
//
// Note that labour and consumables are themselves scaled off capex, so ~99.8%
// of the modelled cost traces back to the machine and how much of the time it
// can be sold — not to what it consumes while running.
//
// So the honest answer to "do cooling and energy prices drive the price of
// quantum compute?" is: not today, and not close. A dilution refrigerator drawing
// 25 kW at $0.08/kWh costs about two dollars an hour to run, against a list
// price of $3,000–7,000 an hour. Even a doubling of industrial electricity moves
// the modelled cost of a QPU-hour by roughly 0.2%.
//
// What actually sets the floor is capital recovery on a ~$20-26M system that is
// billable maybe half the time. That is why the QCI map shows energy and
// cryogenics as small, honestly-scaled contributors rather than headline drivers
// — building the map to imply otherwise would have been the easy thing to do and
// would have been false. The factors are still tracked live, because the ratios
// change as hardware costs fall, and because a reader deserves to see the real
// magnitude rather than be told it is too small to show.
// ──────────────────────────────────────────────────────────────────────────────

import {
  BILLABLE_UTILISATION,
  CAPEX_LIFE_YEARS,
  CONSUMABLES_RATE,
  FACILITY_PUE,
  MODALITY_CAPEX_USD,
  MODALITY_POWER_KW,
  OPEX_LABOUR_RATE,
  type RegistryEntry,
} from "./registry";
import { DEFAULT_FACTORS, INDUSTRIAL_GAS_PPI_BASE, factorValue } from "./sources/factors";
import type { FactorObservation, Modality } from "./types";

const HOURS_PER_YEAR = 8760;

/** Capital recovery factor: the annuity that repays 1 unit of capital over n years at rate r. */
export function capitalRecoveryFactor(rate: number, years: number): number {
  if (years <= 0) return 1;
  if (rate <= 0) return 1 / years;
  const g = Math.pow(1 + rate, years);
  return (rate * g) / (g - 1);
}

export interface CostBreakdown {
  /** USD per QPU-hour, total. */
  total: number;
  energy: number;
  consumables: number;
  labour: number;
  capital: number;
  /** Each component's share of `total`, summing to 1. */
  shares: { energy: number; consumables: number; labour: number; capital: number };
  /** Inputs actually used, for display and audit. */
  inputs: {
    powerKw: number;
    pue: number;
    electricityUsdPerKwh: number;
    electricitySource: string;
    electricityTier: string;
    capexUsd: number;
    discountRate: number;
    discountSource: string;
    billableHoursPerYear: number;
  };
  /**
   * d ln(cost) / d ln(electricity price) — equals the energy share exactly,
   * because energy enters the total linearly. Published so the sensitivity is a
   * stated number rather than an impression.
   */
  energyElasticity: number;
}

/** Resolve the electricity price for a device's actual location. */
function electricityFor(
  entry: Pick<RegistryEntry, "usState" | "euCountry">,
  factors: FactorObservation[],
  usdPerEur: number,
): { usdPerKwh: number; source: string; tier: string } {
  if (entry.usState) {
    const o = factorValue(
      factors,
      `energy.us.${entry.usState.toLowerCase()}`,
      DEFAULT_FACTORS.usIndustrialElectricity,
      `${entry.usState} industrial electricity`,
      "USD/kWh",
    );
    return { usdPerKwh: o.value, source: o.source, tier: o.tier };
  }
  if (entry.euCountry) {
    const o = factorValue(
      factors,
      `energy.eu.${entry.euCountry.toLowerCase()}`,
      DEFAULT_FACTORS.euIndustrialElectricity,
      `${entry.euCountry} industrial electricity`,
      "EUR/kWh",
    );
    // Eurostat quotes EUR/kWh; the index is USD-denominated throughout.
    return { usdPerKwh: o.value * usdPerEur, source: o.source, tier: o.tier };
  }
  return {
    usdPerKwh: DEFAULT_FACTORS.usIndustrialElectricity,
    source: "qci.default",
    tier: "assumed",
  };
}

/**
 * Cost basis for one device-hour.
 *
 * Every input is either a live factor observation or a documented pinned
 * constant; nothing here is fitted to make the answer come out near the price.
 * When the modelled cost lands far below the market price — which it does — that
 * gap is the finding, not an error to be tuned away.
 */
export function deviceCost(
  entry: Pick<RegistryEntry, "usState" | "euCountry"> & { modality: Modality },
  factors: FactorObservation[],
): CostBreakdown {
  const fx = factorValue(
    factors,
    "fx.usd_per_eur",
    DEFAULT_FACTORS.usdPerEur,
    "USD per EUR",
    "USD/EUR",
  );
  const rateObs = factorValue(
    factors,
    "capital.discount_rate",
    DEFAULT_FACTORS.discountRate,
    "discount rate",
    "decimal",
  );
  const ppi = factorValue(
    factors,
    "cryogenics.industrial_gas_ppi",
    DEFAULT_FACTORS.industrialGasPpi,
    "industrial gas PPI",
    "index",
  );

  const power = MODALITY_POWER_KW[entry.modality];
  const capex = MODALITY_CAPEX_USD[entry.modality];
  const elec = electricityFor(entry, factors, fx.value);
  const billableHours = HOURS_PER_YEAR * BILLABLE_UTILISATION;

  const energy = power * FACILITY_PUE * elec.usdPerKwh;

  // Consumables are indexed to the industrial-gas PPI so helium market moves
  // show up, rebased on the REAL level of the series at which CONSUMABLES_RATE
  // was calibrated. Rebasing on a notional 100 instead — which this did — makes
  // the term jump ~2.9× the moment the feed answers, because the series is a
  // 1982-base index running near 288. This is a PROXY, not a helium price: no
  // daily helium feed exists anywhere (USGS publishes annually, and the BLM
  // auctions that once set a public reference have ended).
  const ppiAdjust = ppi.value > 0 ? ppi.value / INDUSTRIAL_GAS_PPI_BASE : 1;
  const consumables = (capex * CONSUMABLES_RATE * ppiAdjust) / billableHours;

  const labour = (capex * OPEX_LABOUR_RATE) / billableHours;
  const capital = (capex * capitalRecoveryFactor(rateObs.value, CAPEX_LIFE_YEARS)) / billableHours;

  const total = energy + consumables + labour + capital;
  const share = (x: number) => (total > 0 ? x / total : 0);

  return {
    total,
    energy,
    consumables,
    labour,
    capital,
    shares: {
      energy: share(energy),
      consumables: share(consumables),
      labour: share(labour),
      capital: share(capital),
    },
    inputs: {
      powerKw: power,
      pue: FACILITY_PUE,
      electricityUsdPerKwh: elec.usdPerKwh,
      electricitySource: elec.source,
      electricityTier: elec.tier,
      capexUsd: capex,
      discountRate: rateObs.value,
      discountSource: rateObs.source,
      billableHoursPerYear: billableHours,
    },
    energyElasticity: share(energy),
  };
}
