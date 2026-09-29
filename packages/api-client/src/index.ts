import type { ApiErrorEnvelope } from "@aevocado/api-contract";
import { createRequestId, normalizeRequestId } from "@aevocado/observability";

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ApiClientRequestInit extends RequestInit {
  idempotencyKey?: string;
  requestId?: string;
  retryOnUnauthorized?: boolean;
}

export interface ApiClientJsonRequest<TBody> extends Omit<ApiClientRequestInit, "body"> {
  body?: TBody;
}

export interface ApiClientOptions {
  baseUrl: string;
  fetcher?: Fetcher;
  credentials?: RequestCredentials;
  defaultHeaders?: HeadersInit;
  timeoutMs?: number;
  onUnauthorized?: () => Promise<boolean>;
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

function normalizeBaseUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("API base URL must use HTTP or HTTPS");
  }
  return parsed.toString().replace(/\/$/u, "");
}

function requestUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//iu.test(path) || path.startsWith("//")) {
    throw new Error("API client paths must be relative to the configured base URL");
  }
  return new URL(path.startsWith("/") ? path : `/${path}`, `${baseUrl}/`).toString();
}

function timeoutError(timeoutMs: number): ApiClientError {
  return new ApiClientError(`API request timed out after ${timeoutMs}ms`, 0, "API_TIMEOUT");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly credentials: RequestCredentials;
  private readonly defaultHeaders: Headers;
  private readonly timeoutMs: number;
  private readonly onUnauthorized?: () => Promise<boolean>;

  constructor(options: ApiClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.credentials = options.credentials ?? "include";
    this.defaultHeaders = new Headers(options.defaultHeaders);
    this.timeoutMs = Math.max(1, Math.trunc(options.timeoutMs ?? 10_000));
    this.onUnauthorized = options.onUnauthorized;
  }

  async request<T>(path: string, options: ApiClientRequestInit = {}): Promise<T> {
    const shouldRetry = options.retryOnUnauthorized ?? true;
    let response = await this.perform(path, options);

    if (response.status === 401 && shouldRetry && this.onUnauthorized && await this.onUnauthorized()) {
      response = await this.perform(path, { ...options, retryOnUnauthorized: false });
    }

    return this.parseResponse<T>(response);
  }

  async requestJson<TResponse, TBody = unknown>(
    path: string,
    options: ApiClientJsonRequest<TBody> = {}
  ): Promise<TResponse> {
    const { body, ...requestOptions } = options;
    return this.request<TResponse>(path, {
      ...requestOptions,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: {
        ...(requestOptions.headers ?? {}),
        "content-type": "application/json"
      }
    });
  }

  private async perform(path: string, options: ApiClientRequestInit): Promise<Response> {
    const url = requestUrl(this.baseUrl, path);
    const requestId = normalizeRequestId(options.requestId) ?? createRequestId();
    const headers = new Headers(this.defaultHeaders);
    new Headers(options.headers).forEach((value, key) => headers.set(key, value));
    if (!headers.has("accept")) headers.set("accept", "application/json");
    headers.set("x-request-id", requestId);
    if (options.idempotencyKey) headers.set("idempotency-key", options.idempotencyKey);

    const controller = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const externalSignal = options.signal;
    const abortFromExternal = (): void => controller.abort(externalSignal?.reason);
    if (externalSignal) {
      if (externalSignal.aborted) abortFromExternal();
      else externalSignal.addEventListener("abort", abortFromExternal, { once: true });
    }
    timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await this.fetcher(url, {
        ...options,
        signal: controller.signal,
        credentials: options.credentials ?? this.credentials,
        headers
      });
    } catch (error) {
      if (isAbortError(error)) {
        if (externalSignal?.aborted) throw error;
        throw timeoutError(this.timeoutMs);
      }
      throw new ApiClientError(
        "Unable to connect to the Aevocado Core API",
        0,
        "API_NETWORK_ERROR",
        requestId,
        error
      );
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    }
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    const requestId = normalizeRequestId(response.headers.get("x-request-id"));
    if (response.status === 204) return undefined as T;

    const contentType = response.headers.get("content-type") ?? "";
    const payload: unknown = contentType.includes("json")
      ? await response.json().catch(() => null)
      : await response.text().catch(() => "");

    if (!response.ok) {
      const envelope = payload as Partial<ApiErrorEnvelope> | null;
      const error = envelope?.error;
      throw new ApiClientError(
        error?.message ?? `API request failed with status ${response.status}`,
        response.status,
        error?.code ?? "API_ERROR",
        error?.requestId ?? requestId,
        error?.details
      );
    }
    return payload as T;
  }
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  return new ApiClient(options);
}
