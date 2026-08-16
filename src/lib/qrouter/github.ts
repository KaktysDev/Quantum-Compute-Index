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

const STATE_SECRET_LABEL = "qrouter:github-oauth-state:v1";

/**
 * Keys accepted for the OAuth `state` HMAC, best first. New states are signed
 * with the head of this list; verification accepts any entry so a deploy that
 * introduces GITHUB_OAUTH_STATE_SECRET does not invalidate the states already
 * in flight (they live for 10 minutes).
 *
 * GITHUB_OAUTH_STATE_SECRET is the dedicated, independently rotatable secret
 * and should be set in every environment. When it is absent we fall back to
 * KEY_ENCRYPTION_SECRET, but domain-separated behind a fixed label rather than
 * used raw, so the two secrets are not literally the same HMAC key. The raw
 * value stays in the accept list purely for states signed before this change.
 */
function stateSecretCandidates(): string[] {
  const keyEncryptionSecret = process.env.KEY_ENCRYPTION_SECRET ?? "";
  return [
    process.env.GITHUB_OAUTH_STATE_SECRET ?? "",
    process.env.GITHUB_STATE_SECRET ?? "",
    keyEncryptionSecret ? createHmac("sha256", keyEncryptionSecret).update(STATE_SECRET_LABEL).digest("base64url") : "",
    keyEncryptionSecret,
    appPrivateKey(),
  ].filter(Boolean);
}

function stateSecret() {
  return stateSecretCandidates()[0] ?? "";
}

export function createGithubInstallationState(principal: Principal) {
  const secret = stateSecret();
  if (!secret) throw new Error("GITHUB_OAUTH_STATE_SECRET is not configured.");
  const payload = base64url(JSON.stringify({
    organizationId: principal.organizationId,
    userId: principal.userId,
    expiresAt: Date.now() + 10 * 60 * 1000,
  }));
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyGithubInstallationState(state: string, principal: Principal) {
  const candidates = stateSecretCandidates();
  const [payload, signature] = state.split(".");
  if (!candidates.length || !payload || !signature) return false;
  const givenBuffer = Buffer.from(signature);
  const signed = candidates.some((secret) => {
    const expectedBuffer = Buffer.from(createHmac("sha256", secret).update(payload).digest("base64url"));
    return givenBuffer.length === expectedBuffer.length && timingSafeEqual(givenBuffer, expectedBuffer);
  });
  if (!signed) return false;
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

function isProduction() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

export interface GithubAccess {
  token?: string;
  /** True when the token is the server-wide fallback, not an org-scoped installation token. */
  shared: boolean;
  /** False when repository reads must reject private repositories outright. */
  allowPrivate: boolean;
}

/**
 * Resolves GitHub credentials for a principal. Org installation tokens are
 * scoped to that org's granted repositories. The process-wide GITHUB_TOKEN is a
 * local-development convenience only: it must never let one production tenant
 * read the server account's private repositories, so in production tenants
 * without an App connection get unauthenticated (public-repo-only) access.
 */
export async function getGithubAccess(principal: Principal): Promise<GithubAccess> {
  const fallback = process.env.GITHUB_TOKEN ?? process.env.GITHUB_APP_TOKEN;
  if (principal.demo) return { token: fallback, shared: true, allowPrivate: true };
  const connection = await getGithubConnection(principal);
  if (connection && githubAppConfigured()) {
    return { token: await createInstallationToken(connection.installation_id), shared: false, allowPrivate: true };
  }
  if (isProduction()) return { shared: true, allowPrivate: false };
  return { token: fallback, shared: true, allowPrivate: true };
}

export async function getGithubAccessToken(principal: Principal) {
  return (await getGithubAccess(principal)).token;
}

/**
 * Verifies that the user completing the installation callback actually has
 * access to that installation, via the GitHub App's user-authorization OAuth
 * flow. Requires GITHUB_APP_CLIENT_ID / GITHUB_APP_CLIENT_SECRET and the App's
 * "Request user authorization (OAuth) during installation" setting.
 */
export async function verifyInstallationOwnership(code: string, installationId: number) {
  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GitHub App OAuth credentials are not configured.");
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "user-agent": "QRouter/1.0" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    cache: "no-store",
  });
  if (!tokenResponse.ok) throw new Error(`GitHub OAuth exchange failed (${tokenResponse.status}).`);
  const tokenData = await tokenResponse.json() as { access_token?: string };
  if (!tokenData.access_token) throw new Error("GitHub OAuth exchange did not return a token.");
  const installationsResponse = await fetch("https://api.github.com/user/installations?per_page=100", {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${tokenData.access_token}`,
      "user-agent": "QRouter/1.0",
      "x-github-api-version": "2022-11-28",
    },
    cache: "no-store",
  });
  if (!installationsResponse.ok) throw new Error(`GitHub installation listing failed (${installationsResponse.status}).`);
  const installations = await installationsResponse.json() as { installations?: Array<{ id: number }> };
  return (installations.installations ?? []).some((installation) => installation.id === installationId);
}

// ── Repository listing (Vercel-style import picker) ────────────────────────────

export interface GithubRepo {
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  updatedAt: string;
  pushedAt: string | null;
  htmlUrl: string;
  language: string | null;
  description: string | null;
}

/**
 * Find one connected repository explicitly named in a chat message.
 *
 * Full `owner/name` references always win. A short repository name is accepted
 * only when it is at least three characters and unique across the installation,
 * so a message cannot silently select the wrong private source.
 */
export function matchGithubRepositoryMention(message: string, repositories: GithubRepo[]): GithubRepo | null {
  const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const containsToken = (value: string) =>
    new RegExp(`(^|[^A-Za-z0-9_.-])${escaped(value)}(?=$|[^A-Za-z0-9_.-])`, "i").test(message);
  // People naturally say repository slugs with punctuation as spaces (for
  // example `quantum-task` becomes “quantum task repo”). Match that spoken
  // form too, while keeping the same token boundaries and uniqueness rule as
  // exact slug matching so a private repository is never selected by a loose
  // substring.
  const containsSpokenSlug = (value: string) => {
    const words = value.split(/[._-]+/).filter(Boolean);
    if (words.length < 2) return false;
    const phrase = words.map(escaped).join("[\\s._-]+");
    const qualifier = "repo(?:sitory)?|project";
    return new RegExp(
      `(^|[^A-Za-z0-9])(?:${phrase}[\\s._-]+(?:${qualifier})|(?:${qualifier})[\\s._-]+${phrase})(?=$|[^A-Za-z0-9])`,
      "i",
    ).test(message);
  };

  const fullNameMatches = repositories.filter((repository) => containsToken(repository.fullName));
  if (fullNameMatches.length === 1) return fullNameMatches[0];

  const nameMatches = repositories.filter(
    (repository) => repository.name.length >= 3 &&
      (containsToken(repository.name) || containsSpokenSlug(repository.name)),
  );
  return nameMatches.length === 1 ? nameMatches[0] : null;
}

export interface GithubQuantumTaskCandidate {
  repository: GithubRepo;
  path: string;
  size: number;
}

// Source-discovery words should describe the circuit, not the action or the
// destination backend. This leaves useful identifiers such as ionq, aria,
// bell, ghz, qaoa and vqe while discarding “run it on qci aer cpu”.
const TASK_SEARCH_STOP_WORDS = new Set([
  "about", "access", "account", "again", "against", "all", "also", "and", "any", "ask", "available",
  "backend", "can", "circuit", "connected", "cpu", "execute", "file", "find", "for", "from", "github",
  "give", "go", "going", "gpu", "have", "into", "just", "locate", "look", "mine", "my", "name", "need",
  "please", "project", "pull", "qasm", "qci", "quantum", "repo", "repository", "run", "search", "simulator",
  "source", "task", "tasks", "tell", "that", "the", "their", "there", "this", "through", "using", "want",
  "which", "with", "workspace", "would", "you", "your",
]);

function searchWords(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((word) => word.length >= 3 && !TASK_SEARCH_STOP_WORDS.has(word));
}

/**
 * Match a natural-language task description against `.qasm` paths across a
 * connected installation. A unique best score is required so chat never picks
 * an arbitrary private circuit when the request is ambiguous.
 */
export function matchGithubQuantumTaskMention(
  message: string,
  candidates: GithubQuantumTaskCandidate[],
): GithubQuantumTaskCandidate | null {
  const ranked = rankGithubQuantumTasks(message, candidates);
  if (!ranked[0] || ranked[0].score === 0) return null;
  if (ranked[1]?.score === ranked[0].score) return null;
  return ranked[0].candidate;
}

/**
 * Find every circuit path independently named in a request. This is the
 * multi-task counterpart to `matchGithubQuantumTaskMention`: a request such as
 * “run the IonQ, IBM, IQM and Bell tasks” intentionally has several equally
 * strong matches, not an ambiguity that should erase repository context.
 */
export function matchGithubQuantumTaskMentions(
  message: string,
  candidates: GithubQuantumTaskCandidate[],
): GithubQuantumTaskCandidate[] {
  const ranked = rankGithubQuantumTasks(message, candidates);
  const pathMatches = ranked.filter(({ pathScore }) => pathScore > 0);
  if (pathMatches.length > 0) return pathMatches.map(({ candidate }) => candidate);
  if (!ranked[0] || ranked[0].score === 0 || ranked[1]?.score === ranked[0].score) return [];
  return [ranked[0].candidate];
}

function rankGithubQuantumTasks(message: string, candidates: GithubQuantumTaskCandidate[]) {
  const terms = [...new Set(searchWords(message))];
  if (!terms.length) {
    return candidates.length === 1 ? [{ candidate: candidates[0], score: 1, pathScore: 1 }] : [];
  }

  const ranked = candidates.map((candidate) => {
    const pathWords = new Set(searchWords(candidate.path));
    const repoWords = new Set(searchWords(`${candidate.repository.fullName} ${candidate.repository.description ?? ""}`));
    const path = candidate.path.toLowerCase();
    const pathScore = terms.reduce((total, term) => {
      if (pathWords.has(term)) return total + 8;
      if (path.includes(term)) return total + 2;
      return total;
    }, 0);
    const repoScore = terms.reduce((total, term) => repoWords.has(term) ? total + 4 : total, 0);
    return { candidate, score: pathScore + repoScore, pathScore };
  }).sort((a, b) => b.score - a.score);
  return ranked;
}

interface RawRepo {
  full_name: string;
  name: string;
  owner?: { login?: string };
  private?: boolean;
  default_branch?: string;
  updated_at?: string;
  pushed_at?: string | null;
  html_url: string;
  language?: string | null;
  description?: string | null;
}

interface GithubAuth {
  token: string;
  /** installation → list via /installation/repositories; user → via /user/repos. */
  mode: "installation" | "user";
}

/**
 * Resolve the best available GitHub auth for this principal AND tell the caller
 * which listing endpoint to use. App installation token wins (per-org, private
 * repos); otherwise a personal GITHUB_TOKEN acts as a single-account fallback so
 * the picker works on localhost without registering an App.
 */
export async function resolveGithubAuth(principal: Principal): Promise<GithubAuth | null> {
  if (!principal.demo && githubAppConfigured()) {
    const connection = await getGithubConnection(principal);
    if (connection) {
      return { token: await createInstallationToken(connection.installation_id), mode: "installation" };
    }
  }
  // The shared fallback token exposes the server account's repositories, so it
  // never serves real tenants in production.
  if (!principal.demo && isProduction()) return null;
  const fallback = process.env.GITHUB_TOKEN ?? process.env.GITHUB_APP_TOKEN;
  return fallback ? { token: fallback, mode: "user" } : null;
}

function mapRepo(raw: RawRepo): GithubRepo {
  return {
    fullName: raw.full_name,
    owner: raw.owner?.login ?? raw.full_name.split("/")[0],
    name: raw.name,
    private: Boolean(raw.private),
    defaultBranch: raw.default_branch ?? "main",
    updatedAt: raw.updated_at ?? "",
    pushedAt: raw.pushed_at ?? null,
    htmlUrl: raw.html_url,
    language: raw.language ?? null,
    description: raw.description ?? null,
  };
}

async function tokenRequest<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "QRouter/1.0",
      "x-github-api-version": "2022-11-28",
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`GitHub repository listing failed (${response.status}).`);
  return response.json() as Promise<T>;
}

/**
 * List repositories the principal can import. Uses the App installation's
 * granted repos when connected, else the personal token's repos. Paginated and
 * capped at 500, most-recently-pushed first. Returns [] when no auth exists.
 */
export async function listGithubRepositories(principal: Principal): Promise<GithubRepo[]> {
  const auth = await resolveGithubAuth(principal);
  if (!auth) return [];
  const perPage = 100;
  const maxPages = 5; // cap at 500 repos
  const repos: GithubRepo[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    if (auth.mode === "installation") {
      const data = await tokenRequest<{ repositories: RawRepo[] }>(
        `/installation/repositories?per_page=${perPage}&page=${page}`,
        auth.token,
      );
      repos.push(...data.repositories.map(mapRepo));
      if (data.repositories.length < perPage) break;
    } else {
      const data = await tokenRequest<RawRepo[]>(
        `/user/repos?per_page=${perPage}&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`,
        auth.token,
      );
      repos.push(...data.map(mapRepo));
      if (data.length < perPage) break;
    }
  }
  repos.sort((a, b) => (b.pushedAt ?? b.updatedAt).localeCompare(a.pushedAt ?? a.updatedAt));
  return repos;
}
