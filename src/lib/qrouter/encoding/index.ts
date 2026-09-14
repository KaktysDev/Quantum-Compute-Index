import { resetProfileCache } from "./adapters";
import { resetComposeCaches } from "./compose";
import { resetParseCache } from "./frontend";

export { ALLOWED_INCLUDES, assertIncludePolicy, classifyWorkload, frontendInfo, measurementMap, parseGateProgram, registerLayout, resetParseCache, sourceMetrics, workloadFromSource } from "./frontend";
export { jcs, jcsHash, orgContentHash } from "./jcs";
export { LOWERING_RULES, expandedUnitary, maxUnitaryError, referenceUnitary } from "./lowering";
export { OP, renderOp, requireOpId, resolveOpId } from "./ops";
export { deriveRequirements, satisfies, staticProfile } from "./satisfy";
export { advertisedCapabilities, adapterFor, encodeForBackend, profileBackend, resetProfileCache } from "./adapters";
export { qasm2ToCqasm, qasm2ToPhotonicProgram, nativeProgramFor, usesNativeEncoder, NATIVE_ENCODER_PROVIDERS } from "./native";
export { buildEnvelope, buildBundle, verificationStatusOf } from "./bundle";
export { decodeProviderResult, largestRemainderCounts, normalizeBitOrder, resultSetToNormalized, rewriteStates } from "./decode";
export { applySatisfaction, buildExecutionEnvelope, cacheKey, cachedTranspile, compileTargets, encodeBundles, encodingTrace, liveStages, resetComposeCaches, satisfactionFailures, selectedBundleForBackend, selectedBundleView } from "./compose";
export { overlayExecute } from "./stages";

export function resetEncodingCaches() {
  resetComposeCaches();
  resetProfileCache();
  resetParseCache();
}
export {
  bitOrderLabel,
  compileChange,
  gateCount,
  payloadByteLength,
  publicEncoding,
  quoteBindingLabel,
  slimAnalysis,
  slimError,
  slimJobForClient,
  slimJobForList,
  slimJobForOwner,
  slimResult,
  slimRouteDecision,
  slimTranspilation,
  stageStory,
  verificationLabel,
  whyRouted,
  workloadLabel,
} from "./public";
export {
  buildEncodingPreview,
  encoderProfile,
  encodingTargets,
  formatMediaType,
  formatPayloadBytes,
  modalityOf,
  quoteOverlayApplies,
  resolvePreviewBackendId,
} from "./preview";
export { RECIPES, getRecipe, productionRecipes } from "./recipes";
export { EncodingError, PLATFORM_BIT_ORDER } from "./types";
export type {
  CapabilityProfile,
  DecodeMap,
  EncodingStage,
  EncodingTrace,
  ExecutionBundle,
  ExecutionEnvelope,
  GateProgram,
  RequirementSet,
  ResultSet,
  VerificationStatus,
  Workload,
  WorkloadKind,
} from "./types";
