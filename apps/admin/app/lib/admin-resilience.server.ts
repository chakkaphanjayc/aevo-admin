import { ApiClient, ApiClientError } from "@aevocado/contracts";

export type DataSourceStatus = "connected" | "degraded" | "not_connected" | "denied";

export interface OptionalResource<T> {
  data: T | null;
  status: DataSourceStatus;
  message?: string;
}

export function isApiUnavailableError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError
    && (error.status === 0 || error.status === 404 || error.status === 408 || error.status === 429 || error.status >= 500);
}

export function connectionStatusForError(error: unknown): "degraded" | "not_connected" {
  if (error instanceof ApiClientError && error.status === 0) return "not_connected";
  return "degraded";
}

export async function requestOptional<T>(api: ApiClient, path: string): Promise<OptionalResource<T>> {
  try {
    return { data: await api.request<T>(path), status: "connected" };
  } catch (error) {
    if (error instanceof ApiClientError && (error.status === 401 || error.status === 403)) {
      return { data: null, status: "denied", message: error.message };
    }
    if (isApiUnavailableError(error)) {
      return {
        data: null,
        status: connectionStatusForError(error),
        message: error.status === 0
          ? "Core API ยังไม่เชื่อมต่อ"
          : "Core API ตอบสนองไม่สมบูรณ์หรือยังไม่มี endpoint นี้"
      };
    }
    throw error;
  }
}
