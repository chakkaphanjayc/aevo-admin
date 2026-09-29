import type { ActionFunctionArgs } from "react-router";
import { proxyToCoreApi, readRequestBody } from "../lib/api-proxy.server";

export async function action({ request }: ActionFunctionArgs): Promise<Response> {
  return proxyToCoreApi(request, "/api/auth/logout", {
    method: "POST",
    body: await readRequestBody(request)
  });
}
