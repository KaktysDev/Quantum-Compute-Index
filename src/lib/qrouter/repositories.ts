export interface RepositoryFile {
  path: string;
  sha: string;
  size: number;
}

export interface RepositoryInspection {
  repository: {
    fullName: string;
    htmlUrl: string;
    defaultBranch: string;
    private: boolean;
    updatedAt: string;
  };
  files: RepositoryFile[];
  config: Record<string, unknown> | null;
}

export interface ProjectSettings {
  shots: number;
  target: string;
  routingMode: "balanced" | "cost" | "speed" | "quality";
  optimizationLevel: number;
  failover: boolean;
  maxAttempts: number;
  timeoutSeconds: number;
}

export interface QRouterProject {
  id: string;
  organization_id: string;
  name: string;
  repository: string;
  repository_url: string;
  default_branch: string;
  production_branch: string;
  circuit_path: string;
  settings: ProjectSettings;
  created_at: string;
  updated_at: string;
  last_deployed_at: string | null;
}

export class RepositorySourceError extends Error {
  constructor(message: string, public status = 422, public type = "repository_error") {
    super(message);
    this.name = "RepositorySourceError";
  }
}

const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REF_PATTERN = /^[A-Za-z0-9_./-]{1,255}$/;

export function normalizeRepository(value: string) {
  const repository = value.trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");
  if (!REPOSITORY_PATTERN.test(repository)) throw new RepositorySourceError("Enter a GitHub repository as owner/name.", 400, "invalid_repository");
  return repository;
}

export function normalizeRef(value: string) {
  const ref = value.trim();
  if (!REF_PATTERN.test(ref) || ref.includes("..") || ref.startsWith("/") || ref.endsWith("/")) {
    throw new RepositorySourceError("The repository ref is invalid.", 400, "invalid_repository_ref");
  }
  return ref;
}

export function normalizeCircuitPath(value: string) {
  const path = value.trim().replace(/^\/+/, "");
  if (!path || path.length > 1024 || path.includes("\0") || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new RepositorySourceError("The circuit path is invalid.", 400, "invalid_circuit_path");
  }
  if (!/\.qasm$/i.test(path)) throw new RepositorySourceError("Repository jobs require a .qasm circuit file.", 400, "invalid_circuit_path");
  return path;
}

function githubHeaders(token?: string, accept = "application/vnd.github+json") {
  return {
    accept,
    "user-agent": "QRouter/1.0",
    "x-github-api-version": "2022-11-28",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

async function githubJson<T>(path: string, token?: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, { headers: githubHeaders(token), cache: "no-store" });
  if (!response.ok) {
    if (response.status === 404) throw new RepositorySourceError("Repository, ref, or file was not found. Private repositories require a GitHub App connection.", 404, "repository_not_found");
    if (response.status === 403) throw new RepositorySourceError("GitHub rejected the request or the API rate limit was reached.", 503, "github_unavailable");
    throw new RepositorySourceError(`GitHub request failed (${response.status}).`, 502, "github_error");
  }
  return response.json() as Promise<T>;
}

function contentPath(repository: string, path: string, ref: string) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `/repos/${repository}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;
}

async function readRepositoryText(repository: string, ref: string, path: string, maxBytes: number, token?: string) {
  const file = await githubJson<{ content?: string; encoding?: string; sha: string; size: number; html_url: string; download_url?: string }>(contentPath(repository, path, ref), token);
  if (file.size > maxBytes) throw new RepositorySourceError(`Repository file exceeds the ${Math.floor(maxBytes / 1000)} KB limit.`, 422, "repository_file_too_large");
  let text: string;
  if (file.content && file.encoding === "base64") {
    text = Buffer.from(file.content.replace(/\n/g, ""), "base64").toString("utf8");
  } else if (file.download_url) {
    const response = await fetch(file.download_url, { headers: githubHeaders(token, "text/plain"), cache: "no-store" });
    if (!response.ok) throw new RepositorySourceError(`Could not download repository file (${response.status}).`, 502, "github_error");
    text = await response.text();
  } else {
    throw new RepositorySourceError("GitHub did not return readable file content.", 502, "github_error");
  }
  if (Buffer.byteLength(text) > maxBytes) throw new RepositorySourceError(`Repository file exceeds the ${Math.floor(maxBytes / 1000)} KB limit.`, 422, "repository_file_too_large");
  return { text, sha: file.sha, htmlUrl: file.html_url };
}

export async function inspectRepository(value: string, requestedRef?: string, token?: string): Promise<RepositoryInspection> {
  const repository = normalizeRepository(value);
  const metadata = await githubJson<{ full_name: string; html_url: string; default_branch: string; private: boolean; updated_at: string }>(`/repos/${repository}`, token);
  const ref = normalizeRef(requestedRef || metadata.default_branch);
  const tree = await githubJson<{ tree?: Array<{ path: string; type: string; sha: string; size?: number }>; truncated?: boolean }>(`/repos/${repository}/git/trees/${encodeURIComponent(ref)}?recursive=1`, token);
  const files = (tree.tree ?? [])
    .filter((item) => item.type === "blob" && /\.qasm$/i.test(item.path))
    .map((item) => ({ path: item.path, sha: item.sha, size: item.size ?? 0 }))
    .slice(0, 500);
  let config: Record<string, unknown> | null = null;
  const configPath = (tree.tree ?? []).find((item) => item.type === "blob" && /(^|\/)qrouter\.json$/i.test(item.path))?.path;
  if (configPath) {
    try {
      const source = await readRepositoryText(repository, ref, configPath, 32_000, token);
      config = JSON.parse(source.text) as Record<string, unknown>;
    } catch {
      config = null;
    }
  }
  return {
    repository: {
      fullName: metadata.full_name,
      htmlUrl: metadata.html_url,
      defaultBranch: metadata.default_branch,
      private: metadata.private,
      updatedAt: metadata.updated_at,
    },
    files,
    config,
  };
}

export async function readCircuitFromRepository(value: string, requestedRef: string, requestedPath: string, token?: string) {
  const repository = normalizeRepository(value);
  const ref = normalizeRef(requestedRef);
  const path = normalizeCircuitPath(requestedPath);
  const source = await readRepositoryText(repository, ref, path, 256_000, token);
  if (!/^\s*OPENQASM\s+(2\.0|3(?:\.0)?)\s*;/i.test(source.text)) {
    throw new RepositorySourceError("The selected repository file is not valid OpenQASM 2 or 3 source.", 422, "invalid_circuit");
  }
  return { repository, ref, path, ...source };
}
