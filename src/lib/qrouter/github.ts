import { createHmac, createSign, timingSafeEqual } from "crypto";
import type { Principal } from "./auth";
import { createAdminClient } from "@/lib/supabase/admin";

export interface GithubConnection {
  installation_id: number;
  account_login: string;
  account_type: string;
  created_at: string;
  updated_at: string;
}

function appPrivateKey() {
  return process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n") ?? "";
}

function base64url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

export function githubAppConfigured() {
  return Boolean(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_SLUG && appPrivateKey());
}

function githubAppJwt() {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = appPrivateKey();
  if (!appId || !privateKey) throw new Error("GitHub App credentials are not configured.");
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const body = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256").update(body).end().sign(privateKey);
  return `${body}.${base64url(signature)}`;
}

function stateSecret() {
  return process.env.GITHUB_STATE_SECRET || process.env.KEY_ENCRYPTION_SECRET || appPrivateKey();
}

export function createGithubInstallationState(principal: Principal) {
  const secret = stateSecret();
  if (!secret) throw new Error("GITHUB_STATE_SECRET is not configured.");
  const payload = base64url(JSON.stringify({
    organizationId: principal.organizationId,
    userId: principal.userId,
    expiresAt: Date.now() + 10 * 60 * 1000,
  }));
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyGithubInstallationState(state: string, principal: Principal) {
  const secret = stateSecret();
  const [payload, signature] = state.split(".");
  if (!secret || !payload || !signature) return false;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const givenBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (givenBuffer.length !== expectedBuffer.length || !timingSafeEqual(givenBuffer, expectedBuffer)) return false;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { organizationId?: string; userId?: string | null; expiresAt?: number };
    return value.organizationId === principal.organizationId && value.userId === principal.userId && Number(value.expiresAt) > Date.now();
  } catch {
    return false;
  }
}

async function appRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${githubAppJwt()}`,
      "user-agent": "QRouter/1.0",
      "x-github-api-version": "2022-11-28",
      ...init?.headers,
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`GitHub App request failed (${response.status}).`);
  return response.json() as Promise<T>;
}

export async function readGithubInstallation(installationId: number) {
  return appRequest<{ id: number; account: { login: string; type: string } }>(`/app/installations/${installationId}`);
}

async function createInstallationToken(installationId: number) {
  const result = await appRequest<{ token: string; expires_at: string }>(`/app/installations/${installationId}/access_tokens`, { method: "POST" });
  return result.token;
}

export async function getGithubConnection(principal: Principal): Promise<GithubConnection | null> {
  if (principal.demo) return null;
  const { data, error } = await createAdminClient().from("github_connections")
    .select("installation_id,account_login,account_type,created_at,updated_at")
    .eq("organization_id", principal.organizationId).maybeSingle();
  if (error) throw error;
  return data as GithubConnection | null;
}

export async function getGithubAccessToken(principal: Principal) {
  const fallback = process.env.GITHUB_TOKEN ?? process.env.GITHUB_APP_TOKEN;
  if (principal.demo) return fallback;
  const connection = await getGithubConnection(principal);
  if (connection && githubAppConfigured()) return createInstallationToken(connection.installation_id);
  return fallback;
}
