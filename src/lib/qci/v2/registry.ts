// ──────────────────────────────────────────────────────────────────────────────
// The basket registry — which devices the index prices, and what we know about
// each one that no API will tell us.
//
// WHY THE BASKET GREW
// v1 collapsed every provider to ONE "representative device", picked as whichever
// had the most qubits:
//
//     collapseOnePerProvider()  → max capacity, tie-broken by fidelity
//
// That looks conservative and is in fact a significant hidden source of the
// phantom moves this rewrite exists to remove. When IBM's largest backend went
// down for maintenance, the representative silently became a DIFFERENT machine
// with a different fidelity — and v1 compared that new machine's numbers against
// yesterday's other machine as if it were the same constituent. A maintenance
// window read as a price move.
//
// v2 prices every eligible device individually. Under the matched-sample link
// (tornqvist.ts) each device is only ever compared with itself, so one going
// down removes one term from a weighted sum instead of swapping the identity of
// a constituent. More devices strictly reduces the variance of the index, and
// per-provider weight caps stop the count from becoming influence.
//
// PROVIDER SET IS UNCHANGED: IBM, IonQ, IQM, QuEra, AQT, Quandela — the same six
// v1 pinned. What changed is the number of MODELS inside them (1 → 4 for IonQ,
// 1 → 2 for IQM, 1 → all online backends for IBM).
// ──────────────────────────────────────────────────────────────────────────────

import type { Modality } from "./types";

export interface RegistryEntry {
  /** Stable index id. Never reuse or rename — it is the ledger's primary key. */
  id: string;
  provider: string;
  device: string;
  modality: Modality;

  /** Where the hardware physically runs — keys the energy factor. */
  region: string;
  /** Two-letter US state code, when the hardware is in the US. */
  usState?: string;
  /** Two-letter EU country code, when the hardware is in Europe. */
  euCountry?: string;

  /** How to find this device in the AWS Braket price list, if it is sold there. */
  braket?: { providerName: string; deviceName: string };

  /**
   * Whether the device counts toward the published index. A registry entry with
   * `inBasket: false` is still collected and displayed — it just does not move
   * the number. That makes candidate devices observable for a while before they
   * are admitted, rather than admitted blind.
   */
  inBasket: boolean;

  /** Documented reason, shown in the methodology page. */
  note?: string;

  /**
   * Published reference specifications for the device.
   *
   * These are NEVER used by the published index — the index only ever prices a
   * device on metrics its operator reported live, because a spec sheet is not a
   * measurement. They exist so the dry-run preview can render a realistic map
   * before provider credentials are configured, and so the UI can show what a
   * device is nominally rated at next to what it actually measured today.
   */
  referenceSpec?: { qubits: number; twoQubitError: number };
}

/**
 * Estimated continuous electrical load of a complete system, in kW.
 *
 * These are order-of-magnitude figures from vendor datasheets and the published
 * energy-consumption literature, and they are `assumed` tier — no vendor
 * publishes per-hour draw as a live feed. They are deliberately per-modality
 * CONSTANTS: because the index compounds log ratios of matched devices, a
 * constant cancels exactly and can never move the published level. They affect
 * only the cost-basis companion series, where their uncertainty is disclosed.
 *
 *   superconducting — dominated by the dilution refrigerator's pulse-tube
 *     compressors (a Bluefors XLD/KIDE-class system runs roughly 10–20 kW)
 *     plus per-qubit control and readout electronics. IBM has publicly put a
 *     complete system near 25 kW.
 *   trapped-ion — no dilution refrigerator; lasers, UHV pumps and control
 *     electronics dominate, so materially lower.
 *   neutral-atom — lasers and vacuum, comparable to trapped ion.
 *   photonic — room-temperature optics, but superconducting nanowire detectors
 *     still need a (much smaller) cryostat.
 */
export const MODALITY_POWER_KW: Record<Modality, number> = {
  superconducting: 25,
  "trapped-ion": 10,
  "neutral-atom": 10,
  photonic: 8,
  spin: 12,
};

/**
 * Power usage effectiveness of the hosting facility — the multiplier from IT
 * load to total drawn power (cooling, power conversion, lighting). 1.5 is a
 * conservative figure for a research/colocation facility.
 */
export const FACILITY_PUE = 1.5;

/**
 * Installed capital cost of a complete system, USD, by modality. Anchored on
 * disclosed commercial system sales (flagship trapped-ion and superconducting
 * systems have transacted in the low tens of millions). `assumed` tier with a
 * wide band — see cost.ts, where the capital term's dominance is the point.
 */
export const MODALITY_CAPEX_USD: Record<Modality, number> = {
  superconducting: 22_000_000,
  "trapped-ion": 26_000_000,
  "neutral-atom": 15_000_000,
  photonic: 12_000_000,
  spin: 10_000_000,
};

/** Depreciation life in years, and the share of wall-clock that is billable. */
export const CAPEX_LIFE_YEARS = 5;
/**
 * QPUs are not available to customers around the clock: daily recalibration,
 * maintenance windows and internal research take a large share of wall-clock.
 * 50% is a deliberately conservative midpoint of what operators describe.
 */
export const BILLABLE_UTILISATION = 0.5;

/** Annual consumables (cryogens, laser diodes, replacement parts) as a share of capex. */
export const CONSUMABLES_RATE = 0.03;
/** Annual operations and maintenance labour as a share of capex. */
export const OPEX_LABOUR_RATE = 0.06;

/**
 * When the engineering constants above were last re-verified against public
 * disclosures.
 *
 * Roughly 90% of the modelled cost basis traces back to these numbers — capital
 * recovery alone is ~71% of it, and labour and consumables are both scaled off
 * capex — so they are the largest pinned inputs on the platform. There is no
 * feed for "what a QPU costs to build" and there is unlikely ever to be one, so
 * the honest handling is not to pretend they are live but to date them and show
 * that date next to the number. `IBM_RATE_REVIEWED_ON` does the same job for the
 * one pinned PRICE in the basket.
 *
 * A constant with a visible review date is a maintained assumption. The same
 * constant without one is indistinguishable from a number nobody has looked at
 * since it was typed.
 */
export const COST_CONSTANTS_REVIEWED_ON = "2026-08-10";

export const REGISTRY: RegistryEntry[] = [
  // ── IonQ — trapped ion, College Park MD; sold through Braket us-east-1 ─────
  // v1 counted ONE IonQ device. All four are separately priced, separately
  // calibrated machines with their own reservation rates, and Forte vs Aria
  // differ by 2.7× on a per-shot basis — collapsing them discarded real signal.
  {
    id: "ionq:aria-1",
    provider: "IonQ",
    device: "Aria-1",
    modality: "trapped-ion",
    region: "us-east-1",
    usState: "MD",
    braket: { providerName: "IonQ", deviceName: "Aria-1" },
    inBasket: true,
    referenceSpec: { qubits: 25, twoQubitError: 0.0055 },
  },
  {
    id: "ionq:aria-2",
    provider: "IonQ",
    device: "Aria-2",
    modality: "trapped-ion",
    region: "us-east-1",
    usState: "MD",
    braket: { providerName: "IonQ", deviceName: "Aria-2" },
    inBasket: true,
    referenceSpec: { qubits: 25, twoQubitError: 0.006 },
  },
  {
    id: "ionq:forte-1",
    provider: "IonQ",
    device: "Forte-1",
    modality: "trapped-ion",
    region: "us-east-1",
    usState: "MD",
    braket: { providerName: "IonQ", deviceName: "Forte-1" },
    inBasket: true,
    referenceSpec: { qubits: 36, twoQubitError: 0.0035 },
  },
  {
    id: "ionq:forte-enterprise-1",
    provider: "IonQ",
    device: "Forte-Enterprise-1",
    modality: "trapped-ion",
    region: "us-east-1",
    usState: "MD",
    braket: { providerName: "IonQ", deviceName: "Forte-Enterprise-1" },
    inBasket: true,
    referenceSpec: { qubits: 36, twoQubitError: 0.0036 },
  },

  // ── IQM — superconducting, Espoo FI; sold through Braket eu-north-1 ────────
  {
    id: "iqm:garnet",
    provider: "IQM",
    device: "Garnet",
    modality: "superconducting",
    region: "eu-north-1",
    euCountry: "FI",
    braket: { providerName: "IQM", deviceName: "Garnet" },
    inBasket: true,
    referenceSpec: { qubits: 20, twoQubitError: 0.0065 },
  },
  {
    id: "iqm:emerald",
    provider: "IQM",
    device: "Emerald",
    modality: "superconducting",
    region: "eu-north-1",
    euCountry: "FI",
    braket: { providerName: "IQM", deviceName: "Emerald" },
    inBasket: true,
    referenceSpec: { qubits: 54, twoQubitError: 0.008 },
  },

  // ── QuEra — neutral atom, Boston MA ───────────────────────────────────────
  {
    id: "quera:aquila",
    provider: "QuEra",
    device: "Aquila",
    modality: "neutral-atom",
    region: "us-east-1",
    usState: "MA",
    braket: { providerName: "QuEra", deviceName: "Aquila" },
    inBasket: true,
    referenceSpec: { qubits: 256, twoQubitError: 0.02 },
  },

  // ── AQT — trapped ion, Innsbruck AT ───────────────────────────────────────
  {
    id: "aqt:ibex-q1",
    provider: "AQT",
    device: "IBEX-Q1",
    modality: "trapped-ion",
    region: "eu-north-1",
    euCountry: "AT",
    braket: { providerName: "AQT", deviceName: "IBEX-Q1" },
    inBasket: true,
    referenceSpec: { qubits: 12, twoQubitError: 0.004 },
  },

  // ── IBM — superconducting, Poughkeepsie / Yorktown NY ─────────────────────
  // IBM rotates its fleet continuously, so backends are DISCOVERED from the live
  // API (see IBM_TEMPLATE). These entries exist only to carry reference specs
  // for the well-known Heron devices, so the dry-run preview can show IBM and so
  // the UI can display a nominal rating beside the measured one. Any IBM backend
  // NOT listed here still enters the index via the template — nothing is gated
  // on this list.
  {
    id: "ibm:ibm_fez",
    provider: "IBM",
    device: "ibm_fez",
    modality: "superconducting",
    region: "ibm-cloud-us-east",
    usState: "NY",
    inBasket: true,
    referenceSpec: { qubits: 156, twoQubitError: 0.0028 },
  },
  {
    id: "ibm:ibm_marrakesh",
    provider: "IBM",
    device: "ibm_marrakesh",
    modality: "superconducting",
    region: "ibm-cloud-us-east",
    usState: "NY",
    inBasket: true,
    referenceSpec: { qubits: 156, twoQubitError: 0.0031 },
  },
  {
    id: "ibm:ibm_torino",
    provider: "IBM",
    device: "ibm_torino",
    modality: "superconducting",
    region: "ibm-cloud-us-east",
    usState: "NY",
    inBasket: true,
    referenceSpec: { qubits: 133, twoQubitError: 0.0035 },
  },

  // ── Rigetti — REGISTERED BUT NOT IN THE BASKET ────────────────────────────
  // v1 deliberately kept Rigetti out: under the old maths a provider joining
  // repriced the index, and Rigetti brings backends online without notice
  // (Cepheus did exactly that). Under v2's matched-sample link that risk is
  // gone — a new constituent contributes nothing on the day it appears and only
  // its own subsequent changes thereafter. Rigetti publishes real reservation
  // rates ($5,750/hr Ankaa-3, $4,100/hr Cepheus-1-108Q), so admitting it would
  // now be a pure coverage gain with no discontinuity.
  //
  // Left OFF because changing the provider set is a deliberate governance
  // decision, not an implementation detail. Flip `inBasket` to true to admit it.
  {
    id: "rigetti:ankaa-3",
    provider: "Rigetti",
    device: "Ankaa-3",
    modality: "superconducting",
    region: "us-west-1",
    usState: "CA",
    braket: { providerName: "Rigetti", deviceName: "Ankaa-3" },
    inBasket: false,
    referenceSpec: { qubits: 84, twoQubitError: 0.015 },
    note: "Candidate. Observed and displayed but excluded from the published index pending a basket-composition decision.",
  },
  {
    id: "rigetti:cepheus-1-108q",
    provider: "Rigetti",
    device: "Cepheus-1-108Q",
    modality: "superconducting",
    region: "us-west-1",
    usState: "CA",
    braket: { providerName: "Rigetti", deviceName: "Cepheus-1-108Q" },
    inBasket: false,
    referenceSpec: { qubits: 108, twoQubitError: 0.011 },
    note: "Candidate. Observed and displayed but excluded from the published index pending a basket-composition decision.",
  },
];

/**
 * IBM backends are discovered from the live API rather than enumerated here —
 * IBM rotates its fleet continuously and a static list would go stale. Every
 * discovered backend is admitted under this template, so IBM contributes as
 * many constituents as it has online devices instead of v1's single one.
 */
export const IBM_TEMPLATE: Omit<RegistryEntry, "id" | "device"> = {
  provider: "IBM",
  modality: "superconducting",
  region: "ibm-cloud-us-east",
  usState: "NY",
  inBasket: true,
};

/**
 * Quandela's photonic platforms, discovered by name probe (their cloud has no
 * list-all endpoint). Photonic hardware has no qubit count or two-qubit gate
 * error in the usual sense, so these enter with documented analogues and are
 * flagged as such in the UI.
 */
export const QUANDELA_TEMPLATE: Omit<RegistryEntry, "id" | "device"> = {
  provider: "Quandela",
  modality: "photonic",
  region: "eu-west-fr",
  euCountry: "FR",
  inBasket: true,
};

export function registryById(): Map<string, RegistryEntry> {
  return new Map(REGISTRY.map((r) => [r.id, r]));
}

/** Regions whose tariffs we must fetch, derived from the basket itself. */
export function requiredEnergyRegions(entries: RegistryEntry[]): {
  usStates: string[];
  euCountries: string[];
} {
  const usStates = new Set<string>();
  const euCountries = new Set<string>();
  for (const e of entries) {
    if (e.usState) usStates.add(e.usState);
    if (e.euCountry) euCountries.add(e.euCountry);
  }
  // IBM and Quandela come from templates, so their regions are added explicitly.
  if (IBM_TEMPLATE.usState) usStates.add(IBM_TEMPLATE.usState);
  if (QUANDELA_TEMPLATE.euCountry) euCountries.add(QUANDELA_TEMPLATE.euCountry);
  return { usStates: [...usStates], euCountries: [...euCountries] };
}
