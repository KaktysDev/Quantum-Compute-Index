"use client";

import { useMemo } from "react";
import { buildEncodingPreview, type EncodingPreviewInput, type EncodingPreviewPlan } from "@/lib/qrouter/encoding/preview";

/** Recomputes the researcher encoding plan whenever platform parameters change. */
export function useEncodingPreview(input: EncodingPreviewInput): EncodingPreviewPlan {
  return useMemo(
    () => buildEncodingPreview(input),
    // Primitive fields only — a new `input` object each render should not recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      input.targetId,
      input.selectedId,
      input.shots,
      input.format,
      input.routingMode,
      input.kind,
      input.qubits,
      input.depth,
      input.gates,
      input.encoding,
      input.transpilation,
      input.candidates,
      input.explanation,
      input.error,
      input.phase,
      input.updating,
      input.sourceBytes,
      input.jobStatus,
    ],
  );
}
