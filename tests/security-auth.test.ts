import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// auth.ts reads QROUTER_RATE_LIMIT_PER_MINUTE once at module load, so the
// ceiling has to be lowered before the import graph is evaluated.
const { RATE_LIMIT } = vi.hoisted(() => {
  const limit = 5;
  process.env.QROUTER_RATE_LIMIT_PER_MINUTE = String(limit);
  return { RATE_LIMIT: limit };
});

interface QueryResult {
  data: unknown;
  error: { code?: string; message?: string } | null;
  count?: number | null;
}

interface Builder extends PromiseLike<QueryResult> {
  select(columns?: string, options?: { count?: "exact"; head?: boolean }): Builder;
  insert(values: Record<string, unknown>): Builder;
  update(values: Record<string, unknown>): Builder;
  eq(column: string, value: unknown): Builder;
  is(column: string, value: unknown): Builder;
  or(filter: string): Builder;
  order(column: string, options?: { ascending: boolean }): Builder;
  limit(count: number): Builder;
  maybeSingle(): Promise<QueryResult>;
  single(): Promise<QueryResult>;
}

interface ApiKeyRow {
  id: string;
  organization_id: string;
  revoked_at: string | null;
  expires_at: string | null;
  scopes: string[];
  environment: string;
}

/** Everything the mocked Supabase clients answer from. Reset in beforeEach. */
const db = {
  /** The loose landing-page predicate: URL + anon key present. */
  configured: true,
  /** The strict auth-path predicate: also requires a service-role key. */
  serviceConfigured: true,
  keysByHash: new Map<string, ApiKeyRow>(),
  user: null as { id: string } | null,
  membership: null as { organization_id: string } | null,
  activeKeyCount: 0,
  /** Errors to return from the next inserts, oldest first. */
  insertErrors: [] as Array<{ code?: string; message?: string }>,
  insertedRows: [] as Array<Record<string, unknown>>,
};

function builder(resolveResult: (state: BuilderState) => QueryResult): Builder {
  const state: BuilderState = { counting: false, inserted: null, filters: new Map() };
  const run = () => resolveResult(state);
  const self: Builder = {
    select: (_columns, options) => { state.counting = Boolean(options?.count); return self; },
    insert: (values) => { state.inserted = values; return self; },
    update: () => self,
    eq: (column, value) => { state.filters.set(column, value); return self; },
    is: () => self,
    or: () => self,
    order: () => self,
    limit: () => self,
    maybeSingle: async () => run(),
    single: async () => run(),
    then: (onfulfilled, onrejected) => Promise.resolve(run()).then(onfulfilled, onrejected),
  };
  return self;
}

interface BuilderState {
  counting: boolean;
  inserted: Record<string, unknown> | null;
  filters: Map<string, unknown>;
}

function apiKeysResult(state: BuilderState): QueryResult {
  if (state.inserted) {
    const failure = db.insertErrors.shift();
    if (failure) return { data: null, error: failure };
    db.insertedRows.push(state.inserted);
    return { data: { id: `key-${db.insertedRows.length}`, created_at: new Date().toISOString(), ...state.inserted }, error: null };
  }
  if (state.counting) return { data: null, error: null, count: db.activeKeyCount };
  const hash = state.filters.get("key_hash");
  if (typeof hash === "string") return { data: db.keysByHash.get(hash) ?? null, error: null };
  return { data: null, error: null };
}

vi.mock("@/lib/supabase/config", () => ({
  SUPABASE_URL: "https://mock.supabase.co",
  SUPABASE_ANON_KEY: "anon-key-that-is-long-enough-to-pass",
  isSupabaseConfigured: () => db.configured,
  isSupabaseServiceConfigured: () => db.configured && db.serviceConfigured,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => builder(apiKeysResult),
    // Pretend supabase/qrouter.sql has not been applied so the limiter uses its
    // documented in-process fallback. No network, fully deterministic.
    rpc: async (fn: string) => (fn === "consume_rate_limit"
      ? { data: null, error: { code: "PGRST202", message: "Could not find the function" } }
      : { data: null, error: null }),
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    from: () => builder(() => ({ data: db.membership, error: null })),
    rpc: async () => ({ data: true, error: null }),
  }),
}));

vi.mock("@/lib/access", () => ({
  canAccessConsole: vi.fn(async () => true),
  consoleDevBypassEnabled: () => false,
}));

import { POST as createApiKeyRoute } from "@/app/api/v1/api-keys/route";
import { canAccessConsole } from "@/lib/access";
import { AuthenticationError, createApiKey, hashApiKey, RateLimitError, resolvePrincipal, type Principal } from "@/lib/qrouter/auth";
import { apiError } from "@/lib/qrouter/http";
import { assertTargetAllowed, AuthorizationError, backendsForPrincipal, requireScope, requireScopeV2 } from "@/lib/qrouter/scopes";
import type { Backend } from "@/lib/qrouter/types";
import { v2Problem } from "@/lib/qrouter/v2-http";
import { resetRateLimitState } from "@/lib/security/rate-limit";

const allowedConsole = vi.mocked(canAccessConsole);

function seedKey(rawKey: string, row: Partial<ApiKeyRow> & { organization_id: string }) {
  db.keysByHash.set(hashApiKey(rawKey), {
    id: row.id ?? "key-1",
    organization_id: row.organization_id,
    revoked_at: row.revoked_at ?? null,
    expires_at: row.expires_at ?? null,
    scopes: row.scopes ?? ["jobs:read", "jobs:write"],
    environment: row.environment ?? "live",
  });
}

const cookieRequest = () => new Request("http://localhost/api/v1/jobs");
const bearerRequest = (key: string) => new Request("http://localhost/api/v1/jobs", { headers: { authorization: `Bearer ${key}` } });

function keyPrincipal(overrides: Partial<Principal> = {}): Principal {
  return { organizationId: "org-1", userId: null, apiKeyId: "key-1", demo: false, scopes: ["jobs:read", "jobs:write"], environment: "live", ...overrides };
}

function sessionPrincipal(overrides: Partial<Principal> = {}): Principal {
  return { organizationId: "org-1", userId: "user-1", apiKeyId: null, demo: false, scopes: ["jobs:read", "jobs:write"], environment: null, ...overrides };
}

const backend = (id: string, kind: Backend["kind"]) => ({ id, kind } as Backend);

describe("QRouter authentication and authorization", () => {
  beforeEach(() => {
    resetRateLimitState();
    db.configured = true;
    db.serviceConfigured = true;
    db.keysByHash.clear();
    db.user = { id: "user-1" };
    db.membership = { organization_id: "org-1" };
    db.activeKeyCount = 0;
    db.insertErrors = [];
    db.insertedRows = [];
    allowedConsole.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  // ── A. Rate limiting ────────────────────────────────────────────────────────

  it("rate limits session-cookie callers, not just API keys", async () => {
    for (let call = 0; call < RATE_LIMIT; call += 1) {
      await expect(resolvePrincipal(cookieRequest())).resolves.toMatchObject({ organizationId: "org-1", userId: "user-1" });
    }
    await expect(resolvePrincipal(cookieRequest())).rejects.toBeInstanceOf(RateLimitError);
  });

  it("surfaces the cookie-auth ceiling as a 429 carrying retry-after", async () => {
    for (let call = 0; call < RATE_LIMIT; call += 1) await resolvePrincipal(cookieRequest());
    const rejected = await resolvePrincipal(cookieRequest()).catch((error: unknown) => error);
    const response = apiError(rejected);
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    await expect(response.json()).resolves.toMatchObject({ error: { type: "rate_limit_error" } });
  });

  it("buckets the ceiling per organization, so extra keys buy no extra budget", async () => {
    seedKey("qci_live_first", { id: "key-1", organization_id: "org-shared" });
    seedKey("qci_live_second", { id: "key-2", organization_id: "org-shared" });

    for (let call = 0; call < RATE_LIMIT; call += 1) {
      const key = call % 2 === 0 ? "qci_live_first" : "qci_live_second";
      await expect(resolvePrincipal(bearerRequest(key))).resolves.toMatchObject({ organizationId: "org-shared" });
    }
    // Both keys are now spent: the budget belongs to the organization.
    await expect(resolvePrincipal(bearerRequest("qci_live_first"))).rejects.toBeInstanceOf(RateLimitError);
    await expect(resolvePrincipal(bearerRequest("qci_live_second"))).rejects.toBeInstanceOf(RateLimitError);
  });

  it("keeps organizations in separate buckets", async () => {
    seedKey("qci_live_alpha", { id: "key-a", organization_id: "org-a" });
    seedKey("qci_live_beta", { id: "key-b", organization_id: "org-b" });

    for (let call = 0; call < RATE_LIMIT; call += 1) await resolvePrincipal(bearerRequest("qci_live_alpha"));
    await expect(resolvePrincipal(bearerRequest("qci_live_alpha"))).rejects.toBeInstanceOf(RateLimitError);
    await expect(resolvePrincipal(bearerRequest("qci_live_beta"))).resolves.toMatchObject({ organizationId: "org-b" });
  });

  // ── A. Console allowlist ────────────────────────────────────────────────────

  it("rejects a session whose account is not on the console allowlist", async () => {
    allowedConsole.mockResolvedValue(false);
    await expect(resolvePrincipal(cookieRequest())).rejects.toThrow(AuthenticationError);
    await expect(resolvePrincipal(cookieRequest())).rejects.toThrow(/not approved/i);
  });

  it("does not spend the organization budget on a rejected session", async () => {
    allowedConsole.mockResolvedValue(false);
    for (let call = 0; call < RATE_LIMIT + 3; call += 1) {
      await expect(resolvePrincipal(cookieRequest())).rejects.toThrow(AuthenticationError);
    }
    allowedConsole.mockResolvedValue(true);
    await expect(resolvePrincipal(cookieRequest())).resolves.toMatchObject({ organizationId: "org-1" });
  });

  // ── B. Fail-closed demo mode ────────────────────────────────────────────────

  it("refuses to invent a principal when Supabase is unconfigured and demo mode is off", async () => {
    db.configured = false;
    db.serviceConfigured = false;
    vi.stubEnv("QROUTER_DEMO_MODE", "");
    await expect(resolvePrincipal(cookieRequest())).rejects.toThrow(AuthenticationError);
    await expect(resolvePrincipal(bearerRequest("qci_test_local_development"))).rejects.toThrow(AuthenticationError);
  });

  it("serves the demo principal only under an explicit opt-in", async () => {
    db.configured = false;
    db.serviceConfigured = false;
    vi.stubEnv("QROUTER_DEMO_MODE", "true");
    await expect(resolvePrincipal(cookieRequest())).resolves.toMatchObject({ organizationId: "demo", demo: true });
    await expect(resolvePrincipal(bearerRequest("qci_test_local_development"))).resolves.toMatchObject({ organizationId: "demo", demo: true });
  });

  it("never serves the demo principal in production, even when opted in", async () => {
    db.configured = false;
    db.serviceConfigured = false;
    vi.stubEnv("QROUTER_DEMO_MODE", "true");
    vi.stubEnv("NODE_ENV", "production");
    await expect(resolvePrincipal(cookieRequest())).rejects.toThrow(AuthenticationError);
    await expect(resolvePrincipal(bearerRequest("qci_test_local_development"))).rejects.toThrow(AuthenticationError);
  });

  it("fails closed on a half-configured deployment with no service-role key", async () => {
    // isSupabaseConfigured() stays true so the landing page still renders; the
    // auth path uses the stricter predicate and must not fall through.
    db.configured = true;
    db.serviceConfigured = false;
    vi.stubEnv("QROUTER_DEMO_MODE", "");
    await expect(resolvePrincipal(bearerRequest("qci_live_anything"))).rejects.toThrow(/storage is not configured/i);
    await expect(resolvePrincipal(cookieRequest())).rejects.toThrow(/Authentication is not configured/i);
  });

  // ── C.1–C.3. Scopes ─────────────────────────────────────────────────────────

  it("carries scopes and environment from the key row onto the principal", async () => {
    seedKey("qci_test_readonly", { id: "key-ro", organization_id: "org-1", scopes: ["jobs:read"], environment: "test" });
    await expect(resolvePrincipal(bearerRequest("qci_test_readonly"))).resolves.toMatchObject({
      apiKeyId: "key-ro", scopes: ["jobs:read"], environment: "test",
    });
  });

  it("denies a key that lacks the scope and exempts console sessions", () => {
    const readOnly = keyPrincipal({ scopes: ["jobs:read"] });
    expect(() => requireScope(readOnly, "jobs:read")).not.toThrow();
    expect(() => requireScope(readOnly, "jobs:write")).toThrow(AuthorizationError);
    expect(() => requireScope(sessionPrincipal({ scopes: [] }), "jobs:write")).not.toThrow();
    // Every key issued so far carries both scopes, so real traffic is unaffected.
    expect(() => requireScope(keyPrincipal(), "jobs:write")).not.toThrow();
  });

  it("fails closed for a key principal whose scopes are unknown", () => {
    expect(() => requireScope(keyPrincipal({ scopes: undefined }), "jobs:read")).toThrow(AuthorizationError);
  });

  it("reports a missing scope as 403 on both /api/v1 and /api/v2", async () => {
    const denied = new AuthorizationError("This API key is missing the \"jobs:write\" scope.");
    const v1 = apiError(denied);
    expect(v1.status).toBe(403);
    await expect(v1.json()).resolves.toMatchObject({ error: { type: "insufficient_scope" } });

    const request = new Request("http://localhost/api/v2/jobs");
    const v2Error = (() => {
      try { requireScopeV2(keyPrincipal({ scopes: ["jobs:read"] }), "jobs:write"); } catch (error) { return error; }
    })();
    const v2 = v2Problem(request, "request-1", v2Error);
    expect(v2.status).toBe(403);
    await expect(v2.json()).resolves.toMatchObject({ status: 403, code: "insufficient_scope" });
  });

  // ── C.4. Test keys are confined to simulators ───────────────────────────────

  it("hides QPUs from a test-environment key and leaves live keys alone", () => {
    const catalog = [backend("qci-aer-gpu", "simulator"), backend("aws-sv1", "simulator"), backend("ibm-brisbane", "qpu")];
    expect(backendsForPrincipal(keyPrincipal({ environment: "test" }), catalog).map((item) => item.id)).toEqual(["qci-aer-gpu", "aws-sv1"]);
    expect(backendsForPrincipal(keyPrincipal({ environment: "live" }), catalog)).toEqual(catalog);
    expect(backendsForPrincipal(sessionPrincipal(), catalog)).toEqual(catalog);
  });

  it("explains the simulator restriction when a test key pins a QPU target", () => {
    const catalog = [backend("qci-aer-gpu", "simulator"), backend("ibm-brisbane", "qpu")];
    const testKey = keyPrincipal({ environment: "test" });
    expect(() => assertTargetAllowed(testKey, "ibm-brisbane", catalog)).toThrow(AuthorizationError);
    expect(() => assertTargetAllowed(testKey, "auto", catalog)).not.toThrow();
    expect(() => assertTargetAllowed(testKey, "qci-aer-gpu", catalog)).not.toThrow();
    // An unrecognised target keeps its existing routing error rather than a 403.
    expect(() => assertTargetAllowed(testKey, "typo-backend", catalog)).not.toThrow();
    expect(() => assertTargetAllowed(keyPrincipal({ environment: "live" }), "ibm-brisbane", catalog)).not.toThrow();
  });

  // ── C.5–C.7. API key issuance ───────────────────────────────────────────────

  it("keeps at most four secret characters in the stored key prefix", () => {
    for (const environment of ["test", "live"] as const) {
      const { key, prefix } = createApiKey(environment);
      expect(key.startsWith(prefix)).toBe(true);
      expect(prefix.startsWith(`qci_${environment}_`)).toBe(true);
      const leaked = prefix.slice(`qci_${environment}_`.length);
      expect(leaked.length).toBeLessThanOrEqual(4);
      // The full secret is 24 bytes of base64url; almost none of it is published.
      expect(key.length - prefix.length).toBeGreaterThan(24);
    }
  });

  const postApiKey = (body: unknown) => createApiKeyRoute(new Request("http://localhost/api/v1/api-keys", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));

  it("rejects an environment outside test/live", async () => {
    const response = await postApiKey({ name: "CI", environment: "staging" });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { type: "invalid_request" } });
    expect(db.insertedRows).toHaveLength(0);
  });

  it("rejects an unknown scope and accepts a least-privilege subset", async () => {
    const rejected = await postApiKey({ name: "CI", scopes: ["jobs:delete"] });
    expect(rejected.status).toBe(400);

    const created = await postApiKey({ name: "CI", environment: "test", scopes: ["jobs:read"] });
    expect(created.status).toBe(201);
    expect(db.insertedRows[0]).toMatchObject({ environment: "test", scopes: ["jobs:read"] });
  });

  it("defaults to both scopes and a live environment", async () => {
    const response = await postApiKey({ name: "Production" });
    expect(response.status).toBe(201);
    expect(db.insertedRows[0]).toMatchObject({ environment: "live", scopes: ["jobs:read", "jobs:write"] });
    expect(String(db.insertedRows[0].key_prefix)).toHaveLength("qci_live_".length + 4);
  });

  it("caps the number of active keys per organization", async () => {
    db.activeKeyCount = 25;
    const response = await postApiKey({ name: "One too many" });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { type: "api_key_limit_reached" } });
    expect(db.insertedRows).toHaveLength(0);
  });

  it("regenerates the prefix when it collides with the unique constraint", async () => {
    db.insertErrors = [{ code: "23505", message: "duplicate key value violates unique constraint" }];
    const response = await postApiKey({ name: "Retry me" });
    expect(response.status).toBe(201);
    expect(db.insertedRows).toHaveLength(1);
  });

  it("still refuses to mint a key from an API key rather than a console session", async () => {
    seedKey("qci_live_minter", { id: "key-m", organization_id: "org-1" });
    const response = await createApiKeyRoute(new Request("http://localhost/api/v1/api-keys", {
      method: "POST", headers: { authorization: "Bearer qci_live_minter", "content-type": "application/json" }, body: "{}",
    }));
    expect(response.status).toBe(403);
  });
});
