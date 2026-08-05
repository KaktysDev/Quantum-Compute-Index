import { V2ApiError, requestId, v2Problem } from "./v2-http";

export async function v2Route(request: Request, handler: (requestIdValue: string) => Promise<Response>) {
  const id = requestId(request);
  try {
    return await handler(id);
  } catch (error) {
    return v2Problem(request, id, error);
  }
}

export async function v2JsonBody(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new V2ApiError(400, "invalid_request", "Request body must be valid JSON.");
  }
}
