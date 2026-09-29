import { ApiClient, ApiClientError } from "@aevocado/contracts";
import type { AccessDecisionResponse, AuthenticatedMeResponse } from "@aevocado/api-contract";
import { createAuthClient } from "@aevocado/auth-client";
import { isAccessAllowed } from "@aevocado/app-access";
import { redirect } from "react-router";
import { connectionStatusForError, isApiUnavailableError } from "./admin-resilience.server";
import type { AdminLoaderData } from "./auth.shared";

export type { AdminLoaderData } from "./auth.shared";

const adminAccessCache = new WeakMap<Request, Promise<AdminLoaderData>>();
const adminAccessFlights = new Map<string, Promise<AdminLoaderData>>();

export function apiOrigin(request?: Request): string {
  return request?.headers.get("x-aevo-runtime-api-url")?.trim()
    || process.env.AEVO_API_URL?.trim()
    || "http://localhost:4001";
}

function readCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return undefined;
  const prefix = `${name}=`;
  const value = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function createAdminApiClient(request: Request): ApiClient {
  const cookie = request.headers.get("cookie");
  return new ApiClient({
    baseUrl: apiOrigin(request),
    credentials: "include",
    timeoutMs: 5_000,
    defaultHeaders: {
      "x-aevo-app": "ADMIN",
      ...(cookie ? { cookie } : {})
    }
  });
}

export function requestCsrfHeaders(request: Request): HeadersInit {
  const token = readCookie(request, process.env.CSRF_COOKIE_NAME?.trim() || "aevo_admin_csrf");
  return token ? { "x-csrf-token": token } : {};
}

function loginRedirect(request: Request): never {
  const url = new URL("/login", request.url);
  const next = `${new URL(request.url).pathname}${new URL(request.url).search}`;
  url.searchParams.set("next", next.startsWith("/") ? next : "/");
  throw redirect(url.toString());
}

async function resolveAdminAccess(request: Request): Promise<AdminLoaderData> {
    const api = createAdminApiClient(request);
    const auth = createAuthClient({ api, application: "ADMIN", accountsPath: "/login" });

    let me: AuthenticatedMeResponse;
    let access: AccessDecisionResponse;
    try {
        me = await auth.me();
        // Core now returns the ADMIN platform decision with the identity
        // response. Keep the second call only as a compatibility fallback for
        // an older Core process during a rolling local/deployment restart.
        access = me.access ?? await auth.access();
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) loginRedirect(request);
    if (isApiUnavailableError(error)) {
      const connection = connectionStatusForError(error);
      return {
        me: null,
        access: null,
        connection,
        connectionMessage: connection === "not_connected"
          ? "Core API ยังไม่เชื่อมต่อ — shell นี้อยู่ใน read-only mode"
          : "Core API เชื่อมต่อได้ไม่สมบูรณ์ — ข้อมูลและ action ถูกจำกัดไว้ก่อน"
      };
    }
    throw error;
  }

  if (!isAccessAllowed(access)) {
    throw new Response("Platform administration permission required", {
      status: 403,
      statusText: "PLATFORM_ACCESS_REQUIRED"
    });
  }

    return {
        me,
        access,
        connection: "connected",
        connectionMessage: "Core API session และ platform access ถูกตรวจสอบแล้ว"
    };
}

export function requireAdminAccess(request: Request): Promise<AdminLoaderData> {
    const cached = adminAccessCache.get(request);
    if (cached) return cached;

    const cookie = request.headers.get("cookie");
    if (cookie && (request.method === "GET" || request.method === "HEAD")) {
        const keyPromise = crypto.subtle.digest("SHA-256", new TextEncoder().encode(cookie.trim())).then((digest) =>
            Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
        );
        const pending = keyPromise.then((key) => {
            const existing = adminAccessFlights.get(key);
            if (existing) return existing;
            const resolved = resolveAdminAccess(request);
            adminAccessFlights.set(key, resolved);
            void resolved.then(
                () => {
                    if (adminAccessFlights.get(key) === resolved) adminAccessFlights.delete(key);
                },
                () => {
                    if (adminAccessFlights.get(key) === resolved) adminAccessFlights.delete(key);
                }
            );
            return resolved;
        }).then((value) => value);
        adminAccessCache.set(request, pending);
        return pending;
    }

    const pending = resolveAdminAccess(request);
    adminAccessCache.set(request, pending);
    return pending;
}
