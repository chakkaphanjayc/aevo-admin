import type { LoaderFunctionArgs } from "react-router";

export function loader(_: LoaderFunctionArgs): Response {
  return new Response(JSON.stringify({ status: "ok", service: "aevo-admin" }), {
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
