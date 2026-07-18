import { createHmac, randomBytes } from "crypto";
import { lookup } from "dns/promises";
import { isIP } from "net";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_DELIVERY_ATTEMPTS = 8;

export function createWebhookSecret() {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

export function encryptWebhookSecret(secret: string) {
  return encryptSecret(secret);
}

function privateAddress(address: string) {
  const lower = address.toLowerCase();
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd") || /^fe[89ab]/.test(lower)) return true;
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19));
}

export async function validateWebhookDestination(rawUrl: string) {
  const url = new URL(rawUrl);
  const localDevelopment = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localDevelopment) throw new Error("Webhook URL must use HTTPS.");
  if (localDevelopment) return url;
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((item) => privateAddress(item.address))) throw new Error("Webhook URL cannot resolve to a private network.");
  return url;
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
    let deliveryError: string | null = null;
    try {
      const { data: endpoint, error: endpointError } = await admin.from("webhook_endpoints").select("url,signing_secret_encrypted,enabled").eq("id", delivery.endpoint_id).maybeSingle();
      if (endpointError) throw endpointError;
      if (!endpoint?.enabled || !endpoint.signing_secret_encrypted) throw new Error("Webhook endpoint is disabled or missing.");
      await validateWebhookDestination(endpoint.url);
      const body = JSON.stringify(delivery.payload);
      const timestamp = Math.floor(Date.now() / 1000);
      const secret = decryptSecret(endpoint.signing_secret_encrypted);
      const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: { "content-type": "application/json", "qrouter-signature": `t=${timestamp},v1=${signature}` },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      responseStatus = response.status;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (value) {
      deliveryError = value instanceof Error ? value.message : "Delivery failed.";
    }

    const terminalFailure = Boolean(deliveryError) && attempt >= MAX_DELIVERY_ATTEMPTS;
    const delaySeconds = Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1));
    await admin.from("webhook_deliveries").update({
      attempt,
      response_status: responseStatus,
      error: deliveryError,
      lease_expires_at: null,
      delivered_at: deliveryError ? null : new Date().toISOString(),
      failed_at: terminalFailure ? new Date().toISOString() : null,
      next_attempt_at: deliveryError ? new Date(Date.now() + delaySeconds * 1000).toISOString() : new Date().toISOString(),
    }).eq("id", delivery.id);
  }));
  return { claimed: deliveries.length };
}
