export type RoutingMode = "balanced" | "cost" | "speed" | "quality";
export type JsonObject = Record<string, unknown>;
export interface Job extends JsonObject { id: string; status: string }

export interface CreateJob {
  circuit: string;
  format?: "openqasm2" | "openqasm3";
  shots?: number;
  target?: string;
  routing_mode?: RoutingMode;
  optimization_level?: 0 | 1 | 2 | 3;
  failover?: boolean;
  max_attempts?: 1 | 2 | 3 | 4 | 5;
  timeout_seconds?: number;
  constraints?: Record<string, unknown>;
  name?: string;
}

export class QRouterError extends Error {
  constructor(message: string, public readonly status: number, public readonly body: unknown) {
    super(message);
    this.name = "QRouterError";
  }
}

export class QRouter {
  constructor(private readonly apiKey: string, private readonly baseUrl = "https://api.qrouter.dev") {}

  private async request<T = JsonObject>(path: string, init: RequestInit = {}, responseType: "json" | "text" = "json"): Promise<T> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
    const body: unknown = responseType === "text" && response.ok ? await response.text() : await response.json().catch(() => null);
    if (!response.ok) {
      const error = body as { error?: { message?: string } } | null;
      throw new QRouterError(error?.error?.message ?? `QRouter request failed (${response.status})`, response.status, body);
    }
    return body as T;
  }

  transpile(input: CreateJob) {
    return this.request("/api/v1/transpile", { method: "POST", body: JSON.stringify(input) });
  }

  jobs = {
    create: (input: CreateJob, idempotencyKey = crypto.randomUUID()) =>
      this.request<Job>("/api/v1/jobs", {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
        body: JSON.stringify(input),
      }),
    list: () => this.request("/api/v1/jobs"),
    get: (id: string) => this.request<Job>(`/api/v1/jobs/${encodeURIComponent(id)}`),
    cancel: (id: string) => this.request<Job>(`/api/v1/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
    result: (id: string) => this.request(`/api/v1/jobs/${encodeURIComponent(id)}/result`),
    transpiledQasm: (id: string) => this.request<string>(`/api/v1/jobs/${encodeURIComponent(id)}/transpiled`, {}, "text"),
    wait: async (id: string, intervalMs = 2_000) => {
      for (;;) {
        const job = await this.jobs.get(id);
        if (["completed", "failed", "cancelled"].includes(job.status)) return job;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    },
  };
}
