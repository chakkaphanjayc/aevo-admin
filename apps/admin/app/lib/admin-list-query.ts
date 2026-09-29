export const ADMIN_LIST_LIMITS = [10, 25, 50] as const;

export type AdminListDirection = "asc" | "desc";

export interface AdminListQuery {
  query: string;
  page: number;
  limit: number;
  sort: string;
  direction: AdminListDirection;
}

export function parseAdminListQuery(url: URL, defaultSort: string, defaultDirection: AdminListDirection = "desc"): AdminListQuery {
  const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
  const limit = ADMIN_LIST_LIMITS.includes(rawLimit as (typeof ADMIN_LIST_LIMITS)[number]) ? rawLimit : 50;
  const rawPage = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
  const rawDirection = url.searchParams.get("direction");
  return {
    query: url.searchParams.get("q")?.trim().slice(0, 200) ?? "",
    page: Number.isFinite(rawPage) ? Math.max(rawPage, 1) : 1,
    limit,
    sort: url.searchParams.get("sort")?.trim() || defaultSort,
    direction: rawDirection === "asc" ? "asc" : rawDirection === "desc" ? "desc" : defaultDirection
  };
}

export function appendAdminListQuery(params: URLSearchParams, query: AdminListQuery): void {
  params.set("limit", String(query.limit));
  if (query.page > 1) params.set("page", String(query.page));
  if (query.query) params.set("q", query.query);
  if (query.sort) params.set("sort", query.sort);
  if (query.direction) params.set("direction", query.direction);
}
