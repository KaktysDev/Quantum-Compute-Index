import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJsonWithRetry, isTransientFetchError } from "@/lib/client/fetch-json";

describe("resilient JSON requests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("recognizes Safari and Chromium transport failures", () => {
    expect(isTransientFetchError(new TypeError("Load failed"))).toBe(true);
    expect(isTransientFetchError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isTransientFetchError(new Error("Load failed"))).toBe(false);
  });

  it("retries one dropped request and returns the JSON response", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("Load failed"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "project-1" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchJsonWithRetry<{ id: string }>("/api/v1/projects", {
      method: "POST",
      body: JSON.stringify({ repository: "owner/repo" }),
    }, { retryDelayMs: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.response.status).toBe(201);
    expect(result.data).toEqual({ id: "project-1" });
  });

  it("does not retry an HTTP error response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Invalid project" } }), { status: 400 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchJsonWithRetry("/api/v1/projects", undefined, { retryDelayMs: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.response.status).toBe(400);
  });
});
