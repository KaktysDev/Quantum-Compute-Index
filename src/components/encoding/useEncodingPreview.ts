"use client";

import { useMemo } from "react";
import { buildEncodingPreview, type EncodingPreviewInput, type EncodingPreviewPlan } from "@/lib/qrouter/encoding/preview";

/** Recomputes the researcher encoding plan whenever platform parameters change. */
export function useEncodingPreview(input: EncodingPreviewInput): EncodingPreviewPlan {
  return useMemo(
    () => buildEncodingPreview(input),
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
