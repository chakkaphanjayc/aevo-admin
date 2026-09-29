import type { LoaderFunctionArgs } from "react-router";
import { proxyToCoreApi } from "../lib/api-proxy.server";

export async function loader({ request }: LoaderFunctionArgs): Promise<Response> {
  return proxyToCoreApi(request, "/api/v1/sync/manifest", { method: "GET" });
}
