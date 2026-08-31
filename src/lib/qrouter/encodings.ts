/**
 * Compatibility surface for native-program encoders.
 * Canonical implementation lives in encoding/native.ts (QEE Phase 4 adapters).
 */

export { EncodingError } from "./encoding/types";
export {
  NATIVE_ENCODER_PROVIDERS,
  nativeProgramFor,
  nativeProgramFor as encodeForBackend,
  parseCoreQasm,
  qasm2ToCqasm,
  qasm2ToPhotonicProgram,
  usesNativeEncoder,
} from "./encoding/native";
