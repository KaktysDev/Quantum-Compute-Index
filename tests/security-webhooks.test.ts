import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listWebhookDeliveries } from "@/app/api/v1/webhooks/deliveries/route";
import { isPubliclyRoutableAddress, processWebhookDeliveries, validateWebhookDestination, WEBHOOK_FAILURE_REASONS, type WebhookFailureReason } from "@/lib/qrouter/webhooks";

// Everything below is stubbed before the module graph loads: these tests must
// never open a socket, resolve a name, or reach Supabase.

const secrets = vi.hoisted(() => ({ signing: "whsec_offline_test_value" }));

const dns = vi.hoisted(() => {
  const answers = new Map<string, string[]>();
  return {
    answers,
    lookup: async (hostname: string) => {
      const resolved = answers.get(hostname);
      if (!resolved) throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
      return resolved.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
    },
  };
});

const network = vi.hoisted(() => {
  type RequestOptions = {
    host?: string;
    port?: number;
    path?: string;
    method?: string;
    headers?: Record<string, string>;
    servername?: string;
    rejectUnauthorized?: boolean;
  };
  type FakeRequest = {
    on: (event: string, listener: (error: unknown) => void) => FakeRequest;
    write: (chunk: string) => boolean;
    end: () => void;
    destroy: (error?: unknown) => void;
  };
  type Outcome = { status: number } | { code: string; message: string };
  const calls: Array<{ secure: boolean; options: RequestOptions; body: string }> = [];
  let outcome: Outcome = { status: 200 };

  const requester = (secure: boolean) => (options: RequestOptions, onResponse: (response: { statusCode: number; resume: () => void }) => void) => {
    const errorListeners: Array<(error: unknown) => void> = [];
    let body = "";
    const client: FakeRequest = {
      on(event, listener) {
        if (event === "error") errorListeners.push(listener);
        return client;
      },
      write(chunk) {
        body += chunk;
        return true;
      },
      end() {
        calls.push({ secure, options, body });
        const settled = outcome;
        queueMicrotask(() => {
          if ("status" in settled) onResponse({ statusCode: settled.status, resume: () => undefined });
          else for (const listener of errorListeners) listener(Object.assign(new Error(settled.message), { code: settled.code }));
        });
      },
      destroy(error) {
        for (const listener of errorListeners) listener(error);
      },
    };
    return client;
  };

  return {
    calls,
    secureRequest: requester(true),
    insecureRequest: requester(false),
    respondWith(next: Outcome) {
      outcome = next;
    },
    reset() {
      calls.length = 0;
      outcome = { status: 200 };
    },
  };
});

const supabase = vi.hoisted(() => {
  let client: unknown = null;
  return {
    use: (next: unknown) => {
      client = next;
    },
    createAdminClient: () => client,
  };
});

vi.mock("node:https", async (importOriginal) => ({ ...(await importOriginal<typeof import("node:https")>()), request: network.secureRequest }));
vi.mock("node:http", async (importOriginal) => ({ ...(await importOriginal<typeof import("node:http")>()), request: network.insecureRequest }));
vi.mock("dns/promises", async (importOriginal) => ({ ...(await importOriginal<typeof import("dns/promises")>()), lookup: dns.lookup }));
vi.mock("node:dns/promises", async (importOriginal) => ({ ...(await importOriginal<typeof import("node:dns/promises")>()), lookup: dns.lookup }));
vi.mock("@/lib/crypto", () => ({ decryptSecret: () => secrets.signing, encryptSecret: (value: string) => value }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: supabase.createAdminClient }));
vi.mock("@/lib/qrouter/auth", () => ({
  resolvePrincipal: async () => ({ organizationId: "org-test", userId: null, apiKeyId: "key-test", demo: false }),
  AuthenticationError: class AuthenticationError extends Error {},
  RateLimitError: class RateLimitError extends Error {},
}));

// Every reason in the closed vocabulary is a lowercase word, so a digit means a
// status, port or address escaped, and an errno means raw upstream text did.
const LEAKED_DETAIL = /\d|econnrefused|enotfound|etimedout|cert_|certificate/i;

type DeliveryUpdate = {
  attempt: number;
  response_status: number | null;
  error: WebhookFailureReason | null;
  delivered_at: string | null;
  failed_at: string | null;
};

const logs: unknown[][] = [];

function stubDeliveryQueue(endpoint: { url: string; enabled?: boolean }) {
  const updates: DeliveryUpdate[] = [];
  supabase.use({
    rpc: async () => ({
      data: [{ id: "delivery-under-test", endpoint_id: "endpoint-under-test", payload: { id: "evt_test", type: "job.completed" }, attempt: 0 }],
      error: null,
    }),
    from: (table: string) => (table === "webhook_endpoints"
      ? {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { url: endpoint.url, signing_secret_encrypted: "cipher", enabled: endpoint.enabled ?? true },
              error: null,
            }),
          }),
        }),
      }
      : {
        update: (values: DeliveryUpdate) => {
          updates.push(values);
          return { eq: async () => ({ error: null }) };
        },
      }),
  });
  return updates;
}

async function runDelivery(endpoint: { url: string; enabled?: boolean }) {
  const updates = stubDeliveryQueue(endpoint);
  await processWebhookDeliveries(1);
  expect(updates).toHaveLength(1);
  return updates[0];
}

describe("webhook SSRF defences", () => {
  beforeEach(() => {
    network.reset();
    dns.answers.clear();
    logs.length = 0;
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logs.push(args);
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("denies every address that is not a verified public unicast address", () => {
    const denied = [
      // IPv4-mapped and IPv4-compatible IPv6, in both dotted and hex spelling.
      "::ffff:127.0.0.1", "::ffff:169.254.169.254", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::127.0.0.1",
      // Unspecified and loopback, compressed and expanded.
      "::", "::1", "0:0:0:0:0:0:0:1", "0000:0000:0000:0000:0000:0000:0000:0001",
      // Link local, unique local, site local and multicast, in mixed case.
      "FE80::1", "fe80:0000:0000:0000:0000:0000:0000:0001", "FE80:0000:0000:0000:0000:0000:0000:0001",
      "feb0::1", "fd00::1", "fc00::1", "fec0::1", "ff02::1", "FF02::1",
      // Tunnels and translators that carry an arbitrary IPv4 payload.
      "2002:7f00:1::", "2002:a9fe:a9fe::", "64:ff9b::7f00:1", "64:ff9b:1::a9fe:a9fe", "2001::1", "2001:20::1", "2001:db8::1",
      // IPv4.
      "127.0.0.1", "169.254.169.254", "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1",
      "100.64.0.1", "0.0.0.0", "255.255.255.255", "224.0.0.1", "192.0.0.1", "192.0.2.1",
      "192.88.99.1", "198.18.0.1", "198.51.100.1", "203.0.113.1",
      // Not addresses at all.
      "not-an-ip", "", "example.com", "1.2.3", "999.1.1.1", "fe80::1%eth0", " 8.8.8.8",
    ];
    for (const address of denied) expect(isPubliclyRoutableAddress(address), address).toBe(false);
  });

  it("allows public unicast addresses", () => {
    const allowed = ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8"];
    for (const address of allowed) expect(isPubliclyRoutableAddress(address), address).toBe(true);
  });

  it("keeps the registration guard and the development loopback escape hatch", async () => {
    dns.answers.set("hooks.internal.test", ["10.0.0.1"]);
    dns.answers.set("10.0.0.1", ["10.0.0.1"]);
    await expect(validateWebhookDestination("https://hooks.internal.test/hooks")).rejects.toThrow("private network");
    await expect(validateWebhookDestination("https://10.0.0.1/hooks")).rejects.toThrow("private network");
    await expect(validateWebhookDestination("http://hooks.example.com/hooks")).rejects.toThrow("HTTPS");
    await expect(validateWebhookDestination("http://localhost:9000/hooks")).resolves.toBeInstanceOf(URL);

    vi.stubEnv("NODE_ENV", "production");
    await expect(validateWebhookDestination("http://localhost:9000/hooks")).rejects.toThrow("HTTPS");
    await expect(validateWebhookDestination("http://127.0.0.1:9000/hooks")).rejects.toThrow("HTTPS");
  });

  it("pins the request to the validated address and keeps the signature contract", async () => {
    dns.answers.set("hooks.example.com", ["93.184.216.34"]);
    network.respondWith({ status: 200 });
    const update = await runDelivery({ url: "https://hooks.example.com/qrouter/events?verbose=1" });

    expect(network.calls).toHaveLength(1);
    const [call] = network.calls;
    expect(call.secure).toBe(true);
    expect(call.options).toMatchObject({
      host: "93.184.216.34",
      port: 443,
      path: "/qrouter/events?verbose=1",
      method: "POST",
      servername: "hooks.example.com",
      rejectUnauthorized: true,
    });
    expect(call.options.headers).toMatchObject({
      host: "hooks.example.com",
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(call.body)),
    });

    const [timestamp, digest] = String(call.options.headers?.["qrouter-signature"]).split(",");
    expect(timestamp).toMatch(/^t=\d+$/);
    expect(digest).toBe(`v1=${createHmac("sha256", secrets.signing).update(`${timestamp.slice(2)}.${call.body}`).digest("hex")}`);
    expect(JSON.parse(call.body)).toMatchObject({ id: "evt_test", type: "job.completed" });
    expect(update).toMatchObject({ error: null, response_status: 200, failed_at: null });
    expect(update.delivered_at).toEqual(expect.any(String));
  });

  it("fails a redirect instead of following it to the metadata service", async () => {
    dns.answers.set("hooks.example.com", ["93.184.216.34"]);
    dns.answers.set("169.254.169.254", ["169.254.169.254"]);
    network.respondWith({ status: 302 });
    const update = await runDelivery({ url: "https://hooks.example.com/hooks" });

    expect(network.calls).toHaveLength(1);
    expect(network.calls[0].options.host).toBe("93.184.216.34");
    expect(network.calls.some((call) => String(call.options.host).includes("169.254")
      || String(call.options.headers?.host).includes("169.254"))).toBe(false);
    expect(update).toMatchObject({ error: "redirect_not_allowed", response_status: 302, delivered_at: null });
  });

  it("refuses destinations that resolve into private space, in any spelling", async () => {
    for (const address of ["10.0.0.5", "169.254.169.254", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe", "::1", "2002:a9fe:a9fe::"]) {
      network.reset();
      dns.answers.set("rebind.example.com", [address]);
      const update = await runDelivery({ url: "https://rebind.example.com/hooks" });
      expect(network.calls, address).toHaveLength(0);
      expect(update, address).toMatchObject({ error: "destination_rejected", response_status: null });
    }
  });

  it("refuses a destination unless every answer is public", async () => {
    dns.answers.set("split.example.com", ["93.184.216.34", "10.0.0.5"]);
    dns.answers.set("empty.example.com", []);

    for (const hostname of ["split.example.com", "empty.example.com"]) {
      network.reset();
      const update = await runDelivery({ url: `https://${hostname}/hooks` });
      expect(network.calls, hostname).toHaveLength(0);
      expect(update, hostname).toMatchObject({ error: "destination_rejected", response_status: null });
    }
  });

  it("persists a classified reason and keeps the detail in the platform log", async () => {
    const scenarios: Array<{ reason: WebhookFailureReason; endpoint: { url: string; enabled?: boolean }; arrange: () => void }> = [
      {
        reason: "connection_failed",
        endpoint: { url: "https://hooks.example.com/hooks" },
        arrange: () => network.respondWith({ code: "ECONNREFUSED", message: "connect ECONNREFUSED 93.184.216.34:443" }),
      },
      {
        reason: "tls_failed",
        endpoint: { url: "https://hooks.example.com/hooks" },
        arrange: () => network.respondWith({ code: "CERT_HAS_EXPIRED", message: "certificate has expired" }),
      },
      {
        reason: "timeout",
        endpoint: { url: "https://hooks.example.com/hooks" },
        arrange: () => network.respondWith({ code: "ETIMEDOUT", message: "connect ETIMEDOUT 93.184.216.34:443" }),
      },
      { reason: "http_error", endpoint: { url: "https://hooks.example.com/hooks" }, arrange: () => network.respondWith({ status: 500 }) },
      { reason: "redirect_not_allowed", endpoint: { url: "https://hooks.example.com/hooks" }, arrange: () => network.respondWith({ status: 307 }) },
      { reason: "endpoint_disabled", endpoint: { url: "https://hooks.example.com/hooks", enabled: false }, arrange: () => undefined },
      { reason: "destination_rejected", endpoint: { url: "https://internal.example.com/hooks" }, arrange: () => dns.answers.set("internal.example.com", ["169.254.169.254"]) },
      { reason: "dns_failure", endpoint: { url: "https://nowhere.example.com/hooks" }, arrange: () => undefined },
    ];

    for (const scenario of scenarios) {
      network.reset();
      dns.answers.set("hooks.example.com", ["93.184.216.34"]);
      scenario.arrange();
      const update = await runDelivery(scenario.endpoint);
      expect(update.error, scenario.reason).toBe(scenario.reason);
      expect(WEBHOOK_FAILURE_REASONS).toContain(update.error);
      expect(String(update.error), scenario.reason).not.toMatch(LEAKED_DETAIL);
      expect(update.delivered_at, scenario.reason).toBeNull();
    }

    const platformLog = JSON.stringify(logs);
    expect(platformLog).toContain("ECONNREFUSED");
    expect(platformLog).not.toContain(secrets.signing);
    expect(platformLog).not.toContain("evt_test");
  });

  it("returns only classified reasons from the deliveries API", async () => {
    const rows = [
      {
        id: "delivery-1", job_id: "job-1", event_type: "job.completed", attempt: 4, response_status: null,
        error: "connect ECONNREFUSED 169.254.169.254:80", next_attempt_at: "2026-08-06T10:00:00Z", delivered_at: null,
        failed_at: null, created_at: "2026-08-06T09:00:00Z",
        webhook_endpoints: { url: "https://hooks.example.com/hooks", organization_id: "org-test" },
      },
      { id: "delivery-2", error: "http_error", response_status: 500 },
      { id: "delivery-3", error: null, response_status: 200 },
      { id: "delivery-4", error: "", response_status: null },
    ];
    supabase.use({
      from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: rows, error: null }) }) }) }) }),
    });

    const response = await listWebhookDeliveries(new Request("http://localhost/api/v1/webhooks/deliveries"));
    const payload = await response.json() as { object: string; data: Array<Record<string, unknown>> };

    expect(response.status).toBe(200);
    expect(payload.object).toBe("list");
    expect(payload.data.map((row) => row.error)).toEqual(["delivery_failed", "http_error", null, null]);
    // Every other field, and the field order, survives the classification.
    expect(Object.keys(payload.data[0])).toEqual(Object.keys(rows[0]));
    expect(payload.data[0]).toMatchObject({ id: "delivery-1", attempt: 4, response_status: null, webhook_endpoints: { url: "https://hooks.example.com/hooks" } });
    expect(JSON.stringify(payload)).not.toMatch(/ECONNREFUSED|169\.254/);
  });
});
