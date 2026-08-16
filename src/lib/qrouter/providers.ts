// Human names for the provider ids carried on every backend, plus the short
// list the routing diagram offers as a starting point.
//
// This lives apart from `catalog.ts` because two unrelated surfaces need it and
// neither should own it: the routing tab draws these names, and the assistant
// validates an incoming `?route=` against them before it will render one as a
// chip in the composer. Anything not on this list is simply ignored there — the
// query string is not allowed to put arbitrary text into the user's message.

import { BACKENDS } from "./catalog";

export const PROVIDER_LABELS: Record<string, string> = {
  ibm: "IBM Quantum",
  ionq: "IonQ",
  "aws-braket": "AWS Braket",
  xanadu: "Xanadu",
  quandela: "Quandela",
  "quantum-inspire": "Quantum Inspire",
  qci: "QCI Simulator",
};

/**
 * Provider display names taken from the live catalog rather than typed in, so
 * the picture cannot drift from what the router can actually reach. Deduped by
 * provider — the diagram is about who we reach, not how many machines each of
 * them runs — and capped at six, which is what the stack has room for.
 */
export const ROUTABLE_PROVIDERS: string[] = [...new Set(BACKENDS.map((backend) => backend.provider))]
  .map((id) => PROVIDER_LABELS[id] ?? id)
  .slice(0, 6);

/** The display name if it is one we actually route to, otherwise null. */
export function resolveProviderLabel(value: string | undefined | null): string | null {
  if (!value) return null;
  const wanted = value.trim().toLowerCase();
  return ROUTABLE_PROVIDERS.find((name) => name.toLowerCase() === wanted) ?? null;
}
