import type { LoaderFunctionArgs } from "react-router";
import { coreApiOrigin } from "../lib/api-proxy.server";

export async function loader({ request }: LoaderFunctionArgs): Promise<Response> {
  try {
    const response = await fetch(new URL("/ready", `${coreApiOrigin(request)}/`), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(2_000)
    });
    return new Response(JSON.stringify({
      status: response.ok ? "ready" : "degraded",
      service: "aevo-admin",
      coreApi: response.ok ? "ready" : "unavailable"
    }), {
      status: response.ok ? 200 : 503,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  } catch {
    return new Response(JSON.stringify({ status: "degraded", service: "aevo-admin", coreApi: "unavailable" }), {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
}
