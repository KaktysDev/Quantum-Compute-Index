// ─────────────────────────────────────────────────────────────────────────────
// API key authorization: scopes and the test/live environment boundary.
//
// `api_keys.scopes` and `api_keys.environment` have existed in the schema since
// the beginning but were never read, so a read-only key could submit jobs and a
// `qci_test_…` key could bill real credits on real hardware. This module is the
// single place both are enforced.
// ─────────────────────────────────────────────────────────────────────────────

import { API_SCOPES, type ApiScope, type Principal } from "./auth";
import { RepositorySourceError } from "./repositories";
import type { Backend } from "./types";
import { V2ApiError } from "./v2-http";

// The canonical list lives in ./auth (which stamps it onto session principals)
// so that this module can depend on ./v2-http — which itself depends on ./auth —
// without forming an import cycle. ./scopes is its public home.
export { API_SCOPES, type ApiScope };

/**
 * Denied for lack of privilege, not lack of identity.
 *
 * Extends `RepositorySourceError` purely because that is the one branch of
 * `apiError()` in ./http that honours a caller-supplied status, which makes
 * this surface as 403 on /api/v1 without touching that file. The v2 problem
 * writer keys off `V2ApiError` instead, hence `requireScopeV2` below.
 */
export class AuthorizationError extends RepositorySourceError {
  constructor(message: string) {
    super(message, 403, "insufficient_scope");
    this.name = "AuthorizationError";
  }
}

/**
 * Asserts an API key carries `scope`. A console session is a full-privilege
 * principal and is exempt; a key principal whose scopes are unknown is denied.
 */
export function requireScope(principal: Principal, scope: ApiScope): void {
  if (!principal.apiKeyId) return;
  if (principal.scopes?.includes(scope)) return;
  throw new AuthorizationError(`This API key is missing the "${scope}" scope.`);
}

/** `requireScope` for /api/v2 handlers, whose error writer only maps `V2ApiError`. */
export function requireScopeV2(principal: Principal, scope: ApiScope): void {
  try {
    requireScope(principal, scope);
  } catch (error) {
    if (error instanceof AuthorizationError) throw new V2ApiError(error.status, error.type, error.message);
    throw error;
  }
}

/**
 * Narrows the routing candidate set to what the principal's environment may
 * reach. A `test` key sees simulators only, so it transparently lands on one
 * instead of being rejected after a QPU has already been selected.
 */
export function backendsForPrincipal(principal: Principal, backends: Backend[]): Backend[] {
  if (principal.environment !== "test") return backends;
  return backends.filter((backend) => backend.kind === "simulator");
}

/**
 * Explains the filter when a test key pins a target that `backendsForPrincipal`
 * removes. Without this the empty candidate pool surfaces as a generic
 * `Unknown backend: …` 500 from the router. Targets that are unknown for other
 * reasons are left alone so existing behaviour is unchanged.
 */
export function assertTargetAllowed(principal: Principal, target: string, backends: Backend[]): void {
  if (principal.environment !== "test" || target === "auto") return;
  const requested = backends.find((backend) => backend.id === target);
  if (!requested || requested.kind === "simulator") return;
  throw new AuthorizationError(
    `Test-environment API keys can only run on simulators. "${target}" is a QPU — target a simulator, use "auto", or issue a live key.`,
  );
}

/** `assertTargetAllowed` for /api/v2 handlers, whose error writer only maps `V2ApiError`. */
export function assertTargetAllowedV2(principal: Principal, target: string, backends: Backend[]): void {
  try {
    assertTargetAllowed(principal, target, backends);
  } catch (error) {
    if (error instanceof AuthorizationError) throw new V2ApiError(error.status, error.type, error.message);
    throw error;
  }
}
