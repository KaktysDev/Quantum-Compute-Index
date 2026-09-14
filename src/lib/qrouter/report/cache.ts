/**
 * Process-local memoization for report narrative, follow-up turns, and PDFs.
 * Keyed by job id + result hash so a changed result never reuses old copy.
 */

import { lruGet, lruSet } from "@/lib/qrouter/encoding/cache";
import type { ReportAskTurn, ReportNarrative } from "./types";

const NARRATIVE_MAX = 64;
const PDF_MAX = 24;
const ASK_MAX = 64;

type NarrativeEntry = ReportNarrative;
type PdfEntry = { bytes: Uint8Array; generatedAt: string };
type AskEntry = { turns: ReportAskTurn[] };

const narratives = new Map<string, NarrativeEntry>();
const pdfs = new Map<string, PdfEntry>();
const asks = new Map<string, AskEntry>();

export function reportCacheKey(jobId: string, resultHash: string): string {
  return `${jobId}:${resultHash}`;
}

export function getCachedNarrative(key: string): ReportNarrative | undefined {
  return lruGet(narratives, key);
}

export function setCachedNarrative(key: string, value: ReportNarrative): ReportNarrative {
  return lruSet(narratives, key, value, NARRATIVE_MAX);
}

export function getCachedPdf(key: string): PdfEntry | undefined {
  return lruGet(pdfs, key);
}

export function setCachedPdf(key: string, bytes: Uint8Array): PdfEntry {
  return lruSet(pdfs, key, { bytes, generatedAt: new Date().toISOString() }, PDF_MAX);
}

export function getAskTurns(key: string): ReportAskTurn[] {
  return lruGet(asks, key)?.turns ?? [];
}

export function appendAskTurn(key: string, turn: ReportAskTurn): ReportAskTurn[] {
  const existing = lruGet(asks, key)?.turns ?? [];
  const turns = [...existing, turn].slice(-8);
  lruSet(asks, key, { turns }, ASK_MAX);
  return turns;
}

/** Test seam. */
export function resetReportCaches() {
  narratives.clear();
  pdfs.clear();
  asks.clear();
}
