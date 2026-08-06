import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as submitContact } from "@/app/api/contact/route";
import { POST as joinWaitlist } from "@/app/api/waitlist/route";
import { CircuitValidationError } from "@/lib/qrouter/analyze";
import { AuthenticationError, RateLimitError } from "@/lib/qrouter/auth";
import { apiError } from "@/lib/qrouter/http";
import { redactError } from "@/lib/security/log";
import { PUBLIC_FORM_LIMIT } from "@/lib/security/public-form";
import { resetRateLimitState } from "@/lib/security/rate-limit";
import { authorizeCronRequest, timingSafeEqualStrings } from "@/lib/security/secrets";
import nextConfig from "../next.config.mjs";

const supabase = vi.hoisted(() => ({ writeError: null as { message: string; code?: string } | null }));

vi.mock("@/lib/supabase/config", () => ({
  SUPABASE_URL: "https://mocked.supabase.co",
  SUPABASE_ANON_KEY: "mocked-anon-key-long-enough-to-pass",
  isSupabaseConfigured: () => true,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    // The shared limiter probes this RPC first; reporting it as missing pins
    // these tests to the in-process fallback instead of a database round trip.
    rpc: async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }),
    from: () => ({
      insert: async () => ({ error: supabase.writeError }),
      upsert: async () => ({ error: supabase.writeError }),
    }),
  }),
}));

const POSTGRES_LEAK = 'relation "public.jobs" does not exist';

function contactRequest(ip: string) {
  return new Request("http://localhost/api/contact", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com", phone: "+1 555 0100", message: "Hello." }),
  });
}

function waitlistRequest(ip: string) {
  return new Request("http://localhost/api/waitlist", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({
      name: "Ada Lovelace",
      email: "ada@example.com",
      linkedin: "https://www.linkedin.com/in/ada-lovelace",
      jobTitle: "Quantum developer",
      quantumExperience: "developer",
      referralSource: "university",
    }),
  });
}

describe("v1 error responses", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never forwards an unrecognised error message to the caller", async () => {
    const response = apiError(new Error(POSTGRES_LEAK));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain(POSTGRES_LEAK);
    expect(body.error).toMatchObject({ type: "server_error", message: "Internal server error." });
    expect(typeof body.error.request_id).toBe("string");
    expect(body.error.request_id.length).toBeGreaterThan(0);
    expect(response.headers.get("x-request-id")).toBe(body.error.request_id);
  });

  it("correlates with a caller-supplied request id and mints one otherwise", async () => {
    const supplied = apiError(new Error(POSTGRES_LEAK), "req-abc-123");
    expect((await supplied.json()).error.request_id).toBe("req-abc-123");
    expect(supplied.headers.get("x-request-id")).toBe("req-abc-123");

    // ~30 route files still call apiError with one argument.
    const first = await apiError(new Error("boom")).json();
    const second = await apiError(new Error("boom")).json();
    expect(first.error.request_id).not.toBe(second.error.request_id);
  });

  // Pins the live v1 contract: these messages are intentional and customer-facing.
  it("keeps the modelled error classes verbatim", async () => {
    const auth = apiError(new AuthenticationError("Missing API key."));
    expect(auth.status).toBe(401);
    expect(await auth.json()).toEqual({ error: { type: "authentication_error", message: "Missing API key." } });

    const limited = apiError(new RateLimitError("Organization rate limit exceeded. Retry shortly.", 42));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("42");
    expect(await limited.json()).toEqual({
      error: { type: "rate_limit_error", message: "Organization rate limit exceeded. Retry shortly." },
    });

    const invalid = apiError(new CircuitValidationError("Circuit is invalid.", ["qreg missing"]));
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toEqual({
      error: { type: "invalid_circuit", message: "Circuit is invalid.", details: ["qreg missing"] },
    });

    const routing = apiError(new Error("No backend satisfies the requested constraints."));
    expect(routing.status).toBe(422);
    expect(await routing.json()).toEqual({
      error: { type: "routing_error", message: "No backend satisfies the requested constraints." },
    });
  });
});

describe("error log redaction", () => {
  it("drops the Postgrest fields that quote customer rows", () => {
    const redacted = redactError({
      name: "PostgrestError",
      message: "duplicate key value violates unique constraint",
      code: "23505",
      details: "Key (circuit)=(OPENQASM 2.0; h q[0];) already exists.",
      hint: "row: OPENQASM 2.0; measure q -> c;",
    });

    expect(redacted).toMatchObject({ name: "PostgrestError", code: "23505" });
    expect(JSON.stringify(redacted)).not.toContain("OPENQASM");
    expect(redacted.details).toBeUndefined();
    expect(redacted.hint).toBeUndefined();
  });
});

describe("cron secret comparison", () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("compares strings without throwing on a length mismatch", () => {
    expect(timingSafeEqualStrings("s3cret-value", "s3cret-value")).toBe(true);
    expect(timingSafeEqualStrings("s3cret-value", "s3cret-valuf")).toBe(false);
    expect(timingSafeEqualStrings("short", "a-considerably-longer-secret")).toBe(false);
    expect(timingSafeEqualStrings("", "")).toBe(true);
    expect(timingSafeEqualStrings("", "x")).toBe(false);
  });

  const bearer = (token: string) =>
    new Request("http://localhost/api/cron/refresh", { headers: { authorization: `Bearer ${token}` } });

  // Request() trims header values, which would hide an empty-secret match
  // behind the transport rather than the helper's own fail-closed check.
  const rawAuthorization = (value: string) => ({ headers: { get: () => value } }) as unknown as Request;

  it("fails closed when CRON_SECRET is unset or empty", () => {
    delete process.env.CRON_SECRET;
    expect(authorizeCronRequest(bearer("anything"))).toBe(false);
    expect(authorizeCronRequest(rawAuthorization("Bearer "))).toBe(false);

    process.env.CRON_SECRET = "";
    expect(authorizeCronRequest(bearer(""))).toBe(false);
    expect(authorizeCronRequest(rawAuthorization("Bearer "))).toBe(false);
    expect(authorizeCronRequest(new Request("http://localhost/api/cron/refresh"))).toBe(false);
  });

  it("accepts only the exact bearer token", () => {
    process.env.CRON_SECRET = "dummy-cron-secret-for-tests";
    expect(authorizeCronRequest(bearer("dummy-cron-secret-for-tests"))).toBe(true);
    expect(authorizeCronRequest(bearer("dummy-cron-secret-for-test"))).toBe(false);
    expect(authorizeCronRequest(bearer("wrong"))).toBe(false);
    expect(authorizeCronRequest(new Request("http://localhost/api/cron/refresh", {
      headers: { authorization: "dummy-cron-secret-for-tests" },
    }))).toBe(false);
  });
});

describe("public form hardening", () => {
  beforeEach(() => {
    resetRateLimitState();
    supabase.writeError = null;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rate limits the contact form per client address", async () => {
    for (let attempt = 0; attempt < PUBLIC_FORM_LIMIT; attempt += 1) {
      expect((await submitContact(contactRequest("203.0.113.10"))).status).toBe(200);
    }

    const blocked = await submitContact(contactRequest("203.0.113.10"));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await blocked.json()).error).toBe("Too many submissions. Please try again later.");

    // Separate address, and the waitlist bucket, are untouched.
    expect((await submitContact(contactRequest("203.0.113.11"))).status).toBe(200);
    expect((await joinWaitlist(waitlistRequest("203.0.113.10"))).status).toBe(200);
  });

  it("rate limits the waitlist form per client address", async () => {
    for (let attempt = 0; attempt < PUBLIC_FORM_LIMIT; attempt += 1) {
      expect((await joinWaitlist(waitlistRequest("198.51.100.7"))).status).toBe(200);
    }

    const blocked = await joinWaitlist(waitlistRequest("198.51.100.7"));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("keeps the honeypot silent and free", async () => {
    const bot = await joinWaitlist(new Request("http://localhost/api/waitlist", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.8" },
      body: JSON.stringify({ website: "https://spam.example", email: "bot@example.com" }),
    }));
    expect(bot.status).toBe(200);
    expect(await bot.json()).toEqual({ ok: true });
  });

  it("hides the Postgres error when the contact insert fails", async () => {
    supabase.writeError = { message: POSTGRES_LEAK, code: "42P01" };

    const response = await submitContact(contactRequest("203.0.113.20"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain(POSTGRES_LEAK);
    expect(body.error).toBe("We could not save your message. Please try again.");
  });

  it("does not spend budget on a request that fails validation", async () => {
    for (let attempt = 0; attempt < PUBLIC_FORM_LIMIT + 3; attempt += 1) {
      const response = await submitContact(new Request("http://localhost/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.30" },
        body: JSON.stringify({ name: "Ada" }),
      }));
      expect(response.status).toBe(400);
    }
    expect((await submitContact(contactRequest("203.0.113.30"))).status).toBe(200);
  });
});

describe("security response headers", () => {
  const headerRule = async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    expect(rules).toHaveLength(1);
    return rules[0];
  };

  it("enforces the safe headers on every route", async () => {
    const rule = await headerRule();
    const headers = new Map(rule.headers.map((header) => [header.key, header.value]));

    expect(rule.source).toBe("/:path*");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Strict-Transport-Security")).toMatch(/^max-age=\d{7,}/);
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
  });

  it("ships the CSP report-only until CSP_ENFORCE flips it", async () => {
    const rule = await headerRule();
    const csp = rule.headers.find((header) => header.key.startsWith("Content-Security-Policy"));

    expect(csp?.key).toBe("Content-Security-Policy-Report-Only");
    expect(csp?.value).toContain("frame-ancestors 'none'");
    expect(csp?.value).toContain("object-src 'none'");
    // Stripe Elements is loaded by src/components/OnboardingForm.tsx.
    expect(csp?.value).toContain("https://js.stripe.com");
  });
});
