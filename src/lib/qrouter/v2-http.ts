import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { logRedactedError } from "@/lib/security/log";
import { AuthenticationError, RateLimitError } from "./auth";
import { EncodingError } from "./encoding/types";

export class V2ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "V2ApiError";
  }
}

export function requestId(request: Request) {
  return request.headers.get("x-request-id")?.trim().slice(0, 128) || randomUUID();
}

export function v2Problem(request: Request, requestIdValue: string, error: unknown) {
  let status = 500;
  let code = "internal_error";
  let detail = "Internal server error.";
  const headers: Record<string, string> = { "content-type": "application/problem+json", "x-request-id": requestIdValue };
  if (error instanceof V2ApiError) ({ status, code, message: detail } = error);
  else if (error instanceof AuthenticationError) { status = 401; code = "authentication_error"; detail = error.message; }
  else if (error instanceof RateLimitError) { status = 429; code = "rate_limit_error"; detail = error.message; headers["retry-after"] = String(error.retryAfterSeconds); }
  else if (error instanceof EncodingError) { status = 422; code = "unsupported_encoding"; detail = error.message; }
  else logRedactedError(`v2 unhandled error (request ${requestIdValue})`, error);
  return NextResponse.json({
    type: `https://api.qrouter.dev/problems/${code}`,
    title: code.split("_").map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join(" "),
    status,
    detail,
    instance: new URL(request.url).pathname,
    code,
    request_id: requestIdValue,
  }, { status, headers });
}

export function v2Json(value: unknown, requestIdValue: string, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-request-id", requestIdValue);
  return NextResponse.json(value, { ...init, headers });
}
