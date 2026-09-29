import type { LoaderFunctionArgs } from "react-router";
import { proxyToCoreApi } from "../lib/api-proxy.server";

export async function loader({ request }: LoaderFunctionArgs): Promise<Response> {
  const url = new URL(request.url);
  return proxyToCoreApi(request, `/api/v1/access${url.search}`, { method: "GET" });
}
