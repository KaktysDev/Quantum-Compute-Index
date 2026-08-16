export interface JsonFetchResult<T> {
  response: Response;
  data: T;
}

export interface JsonFetchRetryOptions {
  /** Number of retries after the initial request. */
  retries?: number;
  retryDelayMs?: number;
}

/**
 * Safari reports a dropped fetch as `TypeError: Load failed`; Chromium usually
 * says `Failed to fetch`. Repository imports are idempotent upserts, so retrying
 * one transport failure is safe and prevents a transient serverless disconnect
 * from turning a successful GitHub scan into a dead end.
 */
export function isTransientFetchError(value: unknown): boolean {
  if (!(value instanceof Error)) return false;
  return value.name === "TypeError"
    && /load failed|failed to fetch|fetch failed|network(?: request)? failed/i.test(value.message);
}

export async function fetchJsonWithRetry<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: JsonFetchRetryOptions = {},
): Promise<JsonFetchResult<T>> {
  const retries = Math.max(0, options.retries ?? 1);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 250);

  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(input, init);
      return { response, data: await response.json() as T };
    } catch (error) {
      if (attempt >= retries || !isTransientFetchError(error)) throw error;
      if (retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }
}
