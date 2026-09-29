const forwardedRequestHeaders = [
  "accept",
  "content-type",
  "cookie",
  "if-none-match",
  "idempotency-key",
  "x-csrf-token",
  "x-request-id"
] as const;

const runtimeApiUrlHeader = "x-aevo-runtime-api-url";

export function coreApiOrigin(request?: Request): string {
  return request?.headers.get(runtimeApiUrlHeader)?.trim()
    || process.env.AEVO_API_URL?.trim()
    || "http://localhost:4001";
}

function coreApiUrl(path: string, request?: Request): string {
  if (!path.startsWith("/")) throw new Error("Core API paths must be absolute paths");
  return new URL(path, `${coreApiOrigin(request)}/`).toString();
}

function requestHeaders(request: Request): Headers {
  const headers = new Headers();
  for (const name of forwardedRequestHeaders) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has("accept")) headers.set("accept", "application/json");
  return headers;
}

function responseHeaders(source: Headers): Headers {
  const headers = new Headers();
  for (const name of ["cache-control", "content-type", "etag", "location", "vary", "x-request-id"]) {
    const value = source.get(name);
    if (value) headers.set(name, value);
  }

  const sourceWithSetCookie = source as Headers & { getSetCookie?: () => string[] };
  const cookies = sourceWithSetCookie.getSetCookie?.() ?? [];
  if (cookies.length > 0) {
    for (const cookie of cookies) headers.append("set-cookie", cookie);
  } else {
    const cookie = source.get("set-cookie");
    if (cookie) headers.set("set-cookie", cookie);
  }

  return headers;
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

export async function proxyToCoreApi(
  request: Request,
  path: string,
  options: { body?: BodyInit | null; method?: string } = {}
): Promise<Response> {
  try {
    const upstream = await fetch(coreApiUrl(path, request), {
      method: options.method ?? request.method,
      headers: requestHeaders(request),
      body: options.body,
      redirect: "manual"
    });

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders(upstream.headers)
    });
  } catch {
    return jsonError(502, "CORE_API_UNAVAILABLE", "Aevo Core API is temporarily unavailable");
  }
}

export async function readRequestBody(request: Request): Promise<string | undefined> {
  const body = await request.text();
  return body.length > 0 ? body : undefined;
}
