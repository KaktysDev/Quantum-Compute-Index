import { createHmac, randomBytes } from "crypto";
import { lookup } from "dns/promises";
import { isIP } from "net";
import { request as insecureRequest, type IncomingMessage } from "node:http";
import { request as secureRequest } from "node:https";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { redactError } from "@/lib/security/log";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_DELIVERY_ATTEMPTS = 8;
const DELIVERY_TIMEOUT_MS = 10_000;
const LOCAL_DEVELOPMENT_HOSTS = ["localhost", "127.0.0.1"];

/**
 * The only values ever written to `webhook_deliveries.error`, which is customer
 * readable through `GET /api/v1/webhooks/deliveries`. Raw upstream or system
 * text must never land there: paired with `response_status` it would turn the
 * delivery worker into an internal port scanner for whoever registered the
 * endpoint.
 */
export const WEBHOOK_FAILURE_REASONS = [
  "endpoint_disabled",
  "destination_rejected",
  "dns_failure",
  "connection_failed",
  "tls_failed",
  "timeout",
  "redirect_not_allowed",
  "http_error",
  "delivery_failed",
] as const;

export type WebhookFailureReason = (typeof WEBHOOK_FAILURE_REASONS)[number];

export class WebhookDeliveryError extends Error {
  constructor(readonly reason: WebhookFailureReason, message: string) {
    super(message);
    this.name = "WebhookDeliveryError";
  }
}

export function createWebhookSecret() {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

export function encryptWebhookSecret(secret: string) {
  return encryptSecret(secret);
}

/** Maps a stored delivery error onto the closed vocabulary; anything else collapses to the catch-all. */
export function webhookFailureReason(stored: unknown): WebhookFailureReason | null {
  if (typeof stored !== "string" || !stored) return null;
  const known = (WEBHOOK_FAILURE_REASONS as readonly string[]).includes(stored);
  return known ? (stored as WebhookFailureReason) : "delivery_failed";
}

/**
 * IPv4 space a webhook must never reach: loopback, RFC 1918 private, CGNAT,
 * link-local (cloud instance metadata lives at 169.254.169.254), the IETF
 * protocol/documentation/benchmark assignments, the 6to4 relay anycast prefix,
 * multicast and the reserved 240/4 block.
 */
function isPubliclyRoutableIpv4(octets: number[]): boolean {
  const [a, b, c] = octets;
  if (a === 0) return false; // 0.0.0.0/8 "this network"
  if (a === 10) return false; // 10.0.0.0/8 private
  if (a === 100 && b >= 64 && b <= 127) return false; // 100.64.0.0/10 carrier NAT
  if (a === 127) return false; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return false; // 169.254.0.0/16 link-local + instance metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12 private
  if (a === 192 && b === 0 && c === 0) return false; // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return false; // 192.0.2.0/24 TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return false; // 192.88.99.0/24 6to4 relay anycast
  if (a === 192 && b === 168) return false; // 192.168.0.0/16 private
  if (a === 198 && (b === 18 || b === 19)) return false; // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // 203.0.113.0/24 TEST-NET-3
  if (a >= 224) return false; // 224/4 multicast + 240/4 reserved, which holds 255.255.255.255
  return true;
}

/** The four octets an IPv6 address embeds in its last two 16-bit groups. */
function embeddedIpv4(high: number, low: number): number[] {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

/**
 * Expands any legal IPv6 literal to its eight 16-bit groups, so classification
 * never depends on how the address happens to be spelled. String prefix tests
 * are case sensitive and blind to zero padding, which is how `FE80:0000::1`
 * used to pass as public.
 *
 * Returns `null` when the literal cannot be parsed, and callers deny on `null`.
 */
function expandIpv6(address: string): number[] | null {
  let text = address;
  const lastColon = text.lastIndexOf(":");
  const trailing = text.slice(lastColon + 1);
  if (trailing.includes(".")) {
    // Dotted tail (`::ffff:127.0.0.1`): fold it into two hex groups so the rest
    // of the parser only ever sees 16-bit groups.
    if (isIP(trailing) !== 4) return null;
    const octets = trailing.split(".").map(Number);
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const elided = 8 - head.length - tail.length;
  if (halves.length === 1 ? elided !== 0 : elided < 1) return null;

  const groups: number[] = [];
  for (const group of [...head, ...Array<string>(Math.max(0, elided)).fill("0"), ...tail]) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    groups.push(parseInt(group, 16));
  }
  return groups.length === 8 ? groups : null;
}

/**
 * Default-deny check for a single resolved address. Only a verified public
 * unicast address is allowed: anything unparseable, embedded, tunnelled or
 * reserved is refused.
 */
export function isPubliclyRoutableAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPubliclyRoutableIpv4(address.split(".").map(Number));
  if (version !== 6) return false; // hostnames, empty strings, scoped or malformed literals

  const groups = expandIpv6(address);
  if (!groups) return false;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;

  if (groups.every((group) => group === 0)) return false; // :: unspecified
  const inLowestBlock = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0;
  if (inLowestBlock && g4 === 0 && g5 === 0) {
    if (g6 === 0 && g7 === 1) return false; // ::1 loopback
    return isPubliclyRoutableIpv4(embeddedIpv4(g6, g7)); // ::a.b.c.d IPv4-compatible
  }
  if (inLowestBlock && g4 === 0 && g5 === 0xffff) return isPubliclyRoutableIpv4(embeddedIpv4(g6, g7)); // ::ffff:a.b.c.d IPv4-mapped
  if (inLowestBlock) return false; // rest of ::/64, e.g. the IPv4-translated ::ffff:0:a.b.c.d form

  if ((g0 & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return false; // fe80::/10 link local
  if ((g0 & 0xffc0) === 0xfec0) return false; // fec0::/10 deprecated site local
  if ((g0 & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  if (g0 === 0x2001 && g1 === 0x0000) return false; // 2001::/32 Teredo, tunnels an arbitrary IPv4
  if (g0 === 0x2001 && (g1 & 0xfff0) === 0x0020) return false; // 2001:20::/28 ORCHIDv2
  if (g0 === 0x2001 && g1 === 0x0db8) return false; // 2001:db8::/32 documentation
  if (g0 === 0x2002) return false; // 2002::/16 6to4, embeds an arbitrary IPv4
  if (g0 === 0x0064 && g1 === 0xff9b) return false; // 64:ff9b::/96 and 64:ff9b:1::/48 NAT64, embed an arbitrary IPv4
  return true;
}

type WebhookTarget = {
  url: URL;
  /** Address the socket must connect to, already cleared by `isPubliclyRoutableAddress`. */
  address: string;
};

/**
 * Resolves the destination exactly once and returns the literal the delivery is
 * pinned to. Resolving here and connecting to the name again later is a DNS
 * rebinding hole, so the caller must use the address this returns.
 */
async function resolveWebhookTarget(rawUrl: string): Promise<WebhookTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new WebhookDeliveryError("destination_rejected", "Webhook URL is invalid.");
  }

  const localDevelopment = process.env.NODE_ENV !== "production" && LOCAL_DEVELOPMENT_HOSTS.includes(url.hostname);
  if (url.protocol !== "https:" && !localDevelopment) throw new WebhookDeliveryError("destination_rejected", "Webhook URL must use HTTPS.");
  if (localDevelopment) return { url, address: url.hostname };

  let answers: Array<{ address: string }>;
  try {
    answers = await lookup(url.hostname, { all: true });
  } catch {
    throw new WebhookDeliveryError("dns_failure", "Webhook URL could not be resolved.");
  }
  if (!answers.length || answers.some((answer) => !isPubliclyRoutableAddress(answer.address))) {
    throw new WebhookDeliveryError("destination_rejected", "Webhook URL cannot resolve to a private network.");
  }
  // Every answer passed, so any of them is safe to pin to.
  return { url, address: answers[0].address };
}

export async function validateWebhookDestination(rawUrl: string) {
  const { url } = await resolveWebhookTarget(rawUrl);
  return url;
}

const TLS_FAILURE_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "EPROTO",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

function transportFailure(error: unknown): WebhookDeliveryError {
  if (error instanceof WebhookDeliveryError) return error;
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
  const detail = error instanceof Error ? error.message : String(error);
  if (TLS_FAILURE_CODES.has(code) || code.startsWith("ERR_TLS") || code.startsWith("ERR_SSL")) return new WebhookDeliveryError("tls_failed", detail);
  if (code === "ETIMEDOUT" || code === "ERR_SOCKET_CONNECTION_TIMEOUT") return new WebhookDeliveryError("timeout", detail);
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return new WebhookDeliveryError("dns_failure", detail);
  return new WebhookDeliveryError("connection_failed", detail);
}

type WebhookRequest = {
  url: URL;
  address: string;
  body: string;
  headers: Record<string, string>;
  timeoutMs: number;
};

/**
 * Posts the payload to an address that has already been validated.
 *
 * `node:https.request` is used instead of `fetch` because, without pulling in
 * `undici`, it is the only way to (1) connect to the exact address we checked
 * rather than letting the stack re-resolve the hostname, which is what makes
 * DNS rebinding work, and (2) refuse redirects — it never follows them, so a
 * 302 to the instance metadata service can only ever come back as a status.
 * TLS still validates the registered hostname through `servername`.
 *
 * Exported as the delivery seam so tests can drive it without a network.
 */
export function deliverWebhook({ url, address, body, headers, timeoutMs }: WebhookRequest): Promise<{ status: number }> {
  const secure = url.protocol === "https:";
  return new Promise<{ status: number }>((resolve, reject) => {
    // Held indirectly because the deadline can only be armed once the request
    // it has to destroy exists.
    const timer: { deadline?: ReturnType<typeof setTimeout> } = {};
    let settled = false;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer.deadline);
      finish();
    };

    const options = {
      host: address,
      port: Number(url.port) || (secure ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: "POST",
      // `host` is an IP literal, so the Host header has to carry the registered
      // name and its non-default port. `URL.host` already brackets IPv6.
      // Content-Length keeps the request identical to what `fetch` sent, since
      // `request.write` alone would switch the body to chunked encoding.
      headers: { ...headers, host: url.host, "content-length": String(Buffer.byteLength(body)) },
    };
    const onResponse = (response: IncomingMessage) => {
      response.resume(); // the body is never read; draining releases the socket
      settle(() => resolve({ status: response.statusCode ?? 0 }));
    };

    const request = secure
      ? secureRequest({
        ...options,
        rejectUnauthorized: true,
        // SNI must be a name, so an IP-literal destination simply goes without.
        ...(isIP(url.hostname) ? {} : { servername: url.hostname }),
      }, onResponse)
      : insecureRequest(options, onResponse);

    timer.deadline = setTimeout(() => {
      request.destroy(new WebhookDeliveryError("timeout", `Webhook delivery exceeded ${timeoutMs}ms.`));
    }, timeoutMs);
    request.on("error", (error) => settle(() => reject(transportFailure(error))));
    request.write(body);
    request.end();
  });
}

type ClaimedDelivery = { id: string; endpoint_id: string; payload: Record<string, unknown>; attempt: number };

export async function processWebhookDeliveries(limit = 25) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_webhook_deliveries", { p_limit: limit, p_lease_seconds: 60 });
  if (error) throw error;
  const deliveries = (data ?? []) as ClaimedDelivery[];
  await Promise.all(deliveries.map(async (delivery) => {
    const attempt = delivery.attempt + 1;
    let responseStatus: number | null = null;
    let failureReason: WebhookFailureReason | null = null;
    try {
      const { data: endpoint, error: endpointError } = await admin.from("webhook_endpoints").select("url,signing_secret_encrypted,enabled").eq("id", delivery.endpoint_id).maybeSingle();
      if (endpointError) throw endpointError;
      if (!endpoint?.enabled || !endpoint.signing_secret_encrypted) throw new WebhookDeliveryError("endpoint_disabled", "Webhook endpoint is disabled or missing.");
      const target = await resolveWebhookTarget(endpoint.url);
      const body = JSON.stringify(delivery.payload);
      const timestamp = Math.floor(Date.now() / 1000);
      const secret = decryptSecret(endpoint.signing_secret_encrypted);
      const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
      const response = await deliverWebhook({
        url: target.url,
        address: target.address,
        body,
        headers: { "content-type": "application/json", "qrouter-signature": `t=${timestamp},v1=${signature}` },
        timeoutMs: DELIVERY_TIMEOUT_MS,
      });
      // Only assigned here, so a status can only ever describe a real response
      // from the validated public endpoint — never a rejected destination.
      responseStatus = response.status;
      if (response.status >= 300 && response.status < 400) throw new WebhookDeliveryError("redirect_not_allowed", `Webhook endpoint returned redirect ${response.status}.`);
      if (response.status < 200 || response.status >= 300) throw new WebhookDeliveryError("http_error", `Webhook endpoint returned HTTP ${response.status}.`);
    } catch (value) {
      failureReason = value instanceof WebhookDeliveryError ? value.reason : "delivery_failed";
      // The detail stays in the platform log; the customer only sees the class.
      console.error(`[webhooks] delivery ${delivery.id} failed on attempt ${attempt} (${failureReason})`, redactError(value));
    }

    const terminalFailure = Boolean(failureReason) && attempt >= MAX_DELIVERY_ATTEMPTS;
    const delaySeconds = Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1));
    await admin.from("webhook_deliveries").update({
      attempt,
      response_status: responseStatus,
      error: failureReason,
      lease_expires_at: null,
      delivered_at: failureReason ? null : new Date().toISOString(),
      failed_at: terminalFailure ? new Date().toISOString() : null,
      next_attempt_at: failureReason ? new Date(Date.now() + delaySeconds * 1000).toISOString() : new Date().toISOString(),
    }).eq("id", delivery.id);
  }));
  return { claimed: deliveries.length };
}
