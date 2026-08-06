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
    // awaiting_payment counts as settled: it only clears once the caller buys
    // credits, so polling through it just spins until the caller gives up.
    wait: async (id: string, intervalMs = 2_000) => {
      for (;;) {
        const job = await this.jobs.get(id);
        if (["completed", "failed", "cancelled", "awaiting_payment"].includes(job.status)) return job;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    },
  };
}

export interface Circuit {
  id: string;
  organization_id: string;
  name: string | null;
  format: "openqasm2" | "openqasm3";
  source_hash: string;
  analysis: JsonObject;
  created_at: string;
  expires_at: string | null;
  released_at: string | null;
}

export interface ExecutionTarget extends Omit<CreateJob, "circuit" | "format" | "name"> {
  key: string;
}

export interface Execution {
  id: string;
  key: string;
  status: string;
  target: string;
  selected_backend_id: string | null;
  shots: number;
  routing_mode: RoutingMode;
  analysis: JsonObject;
  route_decision: JsonObject;
  result_available: boolean;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  quote?: JsonObject;
  error?: JsonObject | null;
}

export type HostedJobStatus = "queued" | "running" | "awaiting_payment" | "completed" | "failed" | "cancelled";

export interface HostedJob extends JsonObject {
  id: string;
  circuit_id: string;
  organization_id: string;
  status: HostedJobStatus;
  metadata: Record<string, string>;
  executions: Execution[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  error: JsonObject | null;
}

export interface CreateHostedJob {
  circuit_id: string;
  executions: ExecutionTarget[];
  metadata?: Record<string, string>;
}

// Terminal for polling purposes: awaiting_payment only clears once the caller
// buys credits, so waiting on it would spin until the caller gives up.
const SETTLED_STATUSES = ["completed", "failed", "cancelled", "awaiting_payment"];

/**
 * The FileRouter-style hosted API. It deliberately lives beside the v1 client
 * so existing QRouter users are not forced onto the resource model at once.
 */
export class QRouterV2 {
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
      const problem = body as { detail?: string; error?: { message?: string } } | null;
      throw new QRouterError(problem?.detail ?? problem?.error?.message ?? `QRouter request failed (${response.status})`, response.status, body);
    }
    return body as T;
  }

  circuits = {
    create: async (input: Pick<CreateJob, "circuit" | "format" | "name">, idempotencyKey = crypto.randomUUID()) => {
      const response = await this.request<{ data: Circuit }>("/api/v2/circuits", {
        method: "POST", headers: { "idempotency-key": idempotencyKey }, body: JSON.stringify(input),
      });
      return response.data;
    },
    get: async (id: string) => (await this.request<{ data: Circuit }>(`/api/v2/circuits/${encodeURIComponent(id)}`)).data,
    release: async (id: string) => (await this.request<{ data: Circuit }>(`/api/v2/circuits/${encodeURIComponent(id)}/release`, { method: "POST" })).data,
    delete: (id: string) => this.request<void>(`/api/v2/circuits/${encodeURIComponent(id)}`, { method: "DELETE" }),
  };

  jobs = {
    create: async (input: CreateHostedJob, idempotencyKey = crypto.randomUUID()) => {
      try {
        const response = await this.request<{ data: HostedJob }>("/api/v2/jobs", {
          method: "POST", headers: { "idempotency-key": idempotencyKey }, body: JSON.stringify(input),
        });
        return response.data;
      } catch (error) {
        // 402 still carries the parked job; the caller needs its id to resume
        // the run once credits arrive.
        const parked = error instanceof QRouterError && error.status === 402 ? (error.body as { data?: HostedJob } | null) : null;
        if (parked?.data) return parked.data;
        throw error;
      }
    },
    get: async (id: string) => (await this.request<{ data: HostedJob }>(`/api/v2/jobs/${encodeURIComponent(id)}`)).data,
    wait: async (id: string, intervalMs = 2_000, onStatus?: (job: HostedJob) => void) => {
      let previous: string | undefined;
      for (;;) {
        const job = await this.jobs.get(id);
        if (job.status !== previous) { onStatus?.(job); previous = job.status; }
        if (SETTLED_STATUSES.includes(job.status)) return job;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    },
    waitForExecution: async (jobId: string, execution: Execution | string, intervalMs = 2_000, onStatus?: (execution: Execution) => void) => {
      const executionId = typeof execution === "string" ? execution : execution.id;
      let previous: string | undefined;
      for (;;) {
        const job = await this.jobs.get(jobId);
        const current = job.executions.find((candidate) => candidate.id === executionId);
        if (!current) throw new QRouterError(`Execution ${executionId} is not part of job ${jobId}.`, 404, null);
        if (current.status !== previous) { onStatus?.(current); previous = current.status; }
        if (SETTLED_STATUSES.includes(current.status)) return current;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    },
  };

  executions = {
    result: (id: string) => this.request<JsonObject>(`/api/v2/executions/${encodeURIComponent(id)}/result`),
    transpiledQasm: (id: string) => this.request<string>(`/api/v2/executions/${encodeURIComponent(id)}/transpiled`, {}, "text"),
    cancel: (id: string) => this.request<{ data: Execution }>(`/api/v2/executions/${encodeURIComponent(id)}/cancel`, { method: "POST" }).then((response) => response.data),
  };

  backends = {
    list: () => this.request<{ data: JsonObject[] }>("/api/v2/backends").then((response) => response.data),
  };

  async run(input: CreateJob, idempotencyKey = crypto.randomUUID()) {
    const circuit = await this.circuits.create({ circuit: input.circuit, format: input.format, name: input.name }, `${idempotencyKey}:circuit`);
    const job = await this.jobs.create({
      circuit_id: circuit.id,
      executions: [{ key: "recommended", ...withoutCircuit(input) }],
    }, idempotencyKey);
    const completed = await this.jobs.wait(job.id);
    const execution = completed.executions.find((candidate) => candidate.key === "recommended");
    if (!execution || execution.status !== "completed") throw new QRouterError("Quantum execution failed.", 502, completed);
    return this.executions.result(execution.id);
  }

  async compare(input: Pick<CreateJob, "circuit" | "format" | "name">, executions: ExecutionTarget[], idempotencyKey = crypto.randomUUID()) {
    const circuit = await this.circuits.create(input, `${idempotencyKey}:circuit`);
    const accepted = await this.jobs.create({ circuit_id: circuit.id, executions }, idempotencyKey);
    return this.jobs.wait(accepted.id);
  }
}

function withoutCircuit(input: CreateJob): Omit<ExecutionTarget, "key"> {
  return Object.fromEntries(Object.entries(input).filter(([key]) => !["circuit", "format", "name"].includes(key))) as Omit<ExecutionTarget, "key">;
}
