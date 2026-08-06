import { createHash, randomBytes } from "crypto";
import { canAccessConsole } from "@/lib/access";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

/**
 * Scopes an API key can carry. Defined here rather than in ./scopes so that
 * ./scopes can import ./v2-http (which imports this module) without creating a
 * cycle; ./scopes re-exports these as their public home.
 */
export const API_SCOPES = ["jobs:read", "jobs:write"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export interface Principal {
  organizationId: string;
  userId: string | null;
  apiKeyId: string | null;
  demo: boolean;
  /**
   * Scopes on the API key, or every scope for a console session. Optional so
   * hand-built principals still typecheck; absent scopes on a key principal are
   * treated as no scopes at all.
   */
  scopes?: string[];
  /** `null` for console sessions, which are not bound to an environment. */
  environment?: "test" | "live" | null;
}

export class AuthenticationError extends Error {}

export class RateLimitError extends Error {
  constructor(message = "Organization rate limit exceeded. Retry shortly.", public retryAfterSeconds = 60) {
    super(message);
    this.name = "RateLimitError";
  }
}

/**
 * Ceiling per organization per minute, shared by API keys and console sessions.
 *
 * The old limiter bucketed per API key, so N keys bought N x the budget. Moving
 * to one bucket per organization closes that, but it also means every console
 * tab now draws from the same allowance: TasksTable and RepositoryDeployments
 * each poll every 5s (12 req/min per open tab). The default is 600 so a team
 * can keep tens of tabs open without tripping it; lower it with
 * QROUTER_RATE_LIMIT_PER_MINUTE once real traffic is understood.
 */
const API_RATE_LIMIT_PER_MINUTE = Number(process.env.QROUTER_RATE_LIMIT_PER_MINUTE ?? 600);

/**
 * Demo mode serves a shared, unauthenticated `demo` tenant backed by
 * process-global maps. It used to switch itself on whenever Supabase config was
 * absent, which made a misconfigured deployment silently anonymous, so it now
 * requires a deliberate opt-in and is never available in production.
 */
function demoModeEnabled(): boolean {
  return process.env.QROUTER_DEMO_MODE === "true" && process.env.NODE_ENV !== "production";
}

export function hashApiKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Characters of the random secret kept in the stored/display prefix. The prefix
 * is readable by every org member through RLS, so it stays short: `qci_live_`
 * is 9 characters, and the old `slice(0, 17)` published the first 8 characters
 * of the secret alongside its hash.
 */
const KEY_PREFIX_SECRET_CHARS = 4;
const KEY_PREFIX_LENGTH = "qci_live_".length + KEY_PREFIX_SECRET_CHARS;

/** The environment-qualified label stored in `api_keys.key_prefix` and shown in the console. */
export function keyPrefix(key: string) {
  return key.slice(0, KEY_PREFIX_LENGTH);
}

export function createApiKey(environment: "test" | "live" = "live") {
  const secret = randomBytes(24).toString("base64url");
  const key = `qci_${environment}_${secret}`;
  return { key, prefix: keyPrefix(key), hash: hashApiKey(key) };
}

async function enforceOrganizationRateLimit(organizationId: string) {
  const decision = await consumeRateLimit(`org:${organizationId}`, API_RATE_LIMIT_PER_MINUTE, 60);
  if (!decision.allowed) throw new RateLimitError(undefined, decision.retryAfterSeconds);
}

export async function resolvePrincipal(request: Request): Promise<Principal> {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const rawKey = authorization.slice(7).trim();
    if (!rawKey.startsWith("qci_")) throw new AuthenticationError("Invalid API key format.");
    if (!isSupabaseServiceConfigured()) {
      if (demoModeEnabled() && rawKey === "qci_test_local_development") {
        return { organizationId: "demo", userId: null, apiKeyId: "demo", demo: true, scopes: [...API_SCOPES], environment: "test" };
      }
      throw new AuthenticationError("API key storage is not configured.");
    }
    const admin = createAdminClient();
    const { data, error } = await admin.from("api_keys").select("id, organization_id, revoked_at, expires_at, scopes, environment").eq("key_hash", hashApiKey(rawKey)).maybeSingle();
    if (error || !data || data.revoked_at || (data.expires_at && new Date(data.expires_at) <= new Date())) {
      throw new AuthenticationError("Invalid or expired API key.");
    }
    await enforceOrganizationRateLimit(data.organization_id);
    await admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
    return {
      organizationId: data.organization_id,
      userId: null,
      apiKeyId: data.id,
      demo: false,
      scopes: Array.isArray(data.scopes) ? data.scopes as string[] : [],
      environment: data.environment === "test" ? "test" : "live",
    };
  }

  if (!isSupabaseServiceConfigured()) {
    if (!demoModeEnabled()) throw new AuthenticationError("Authentication is not configured.");
    return { organizationId: "demo", userId: "demo", apiKeyId: null, demo: true, scopes: [...API_SCOPES], environment: null };
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new AuthenticationError("Authentication required.");
  // The allowlist behind can_access_console() is otherwise only enforced by
  // middleware on /dashboard, so a blocked account could still drive the API
  // with its session cookie.
  if (!await canAccessConsole(supabase)) throw new AuthenticationError("This account is not approved for console or API access.");
  const { data } = await supabase.from("organization_members").select("organization_id").eq("user_id", user.id).limit(1).maybeSingle();
  if (!data) throw new AuthenticationError("No workspace is associated with this account.");
  await enforceOrganizationRateLimit(data.organization_id);
  return { organizationId: data.organization_id, userId: user.id, apiKeyId: null, demo: false, scopes: [...API_SCOPES], environment: null };
}
