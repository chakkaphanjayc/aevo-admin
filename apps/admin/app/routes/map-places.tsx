import { MapPinned } from "lucide-react";
import { Card, OfflineState, StatusBadge } from "@aevocado/design-system";
import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { AdminListStandard, type AdminListColumn } from "../components/admin-list-standard";
import { requestOptional, type DataSourceStatus } from "../lib/admin-resilience.server";
import { parseAdminListQuery, type AdminListDirection } from "../lib/admin-list-query";
import { createAdminApiClient, requireAdminAccess } from "../lib/auth.server";
import { hasAdminPermission, type AdminLoaderData } from "../lib/auth.shared";

interface AdminPlace {
  placeId: string;
  slug: string;
  name: string;
  status: string;
  categoryId: string;
  displayLatitude: number | null;
  displayLongitude: number | null;
  revision: number;
  sourceRevision: string;
  projectionStatus: string | null;
  freshnessState: string | null;
  projectionVersion: string | null;
  projectionGeneratedAt: string | null;
}

interface AdminPlaceResource { success: true; places: AdminPlace[]; page: number; limit: number; hasMore: boolean; readOnly: true; projectionBoundary: string; }

interface MapPlacesLoaderData {
  session: AdminLoaderData;
  places: AdminPlace[];
  status: DataSourceStatus;
  denied: boolean;
  canWrite: boolean;
  query: string;
  lifecycle: string;
  page: number;
  limit: number;
  sort: string;
  direction: AdminListDirection;
  hasMore: boolean;
  message?: string;
}

export async function loader({ request }: LoaderFunctionArgs): Promise<MapPlacesLoaderData> {
  const session = await requireAdminAccess(request);
  const url = new URL(request.url);
  const listQuery = parseAdminListQuery(url, "generated", "desc");
  const lifecycle = url.searchParams.get("status")?.trim() ?? "";
  if (session.connection !== "connected") return { session, places: [], status: session.connection, denied: false, canWrite: false, query: listQuery.query, lifecycle, page: listQuery.page, limit: listQuery.limit, sort: listQuery.sort, direction: listQuery.direction, hasMore: false, message: session.connectionMessage };
  if (!hasAdminPermission(session, "map.places.read")) return { session, places: [], status: "denied", denied: true, canWrite: false, query: listQuery.query, lifecycle, page: listQuery.page, limit: listQuery.limit, sort: listQuery.sort, direction: listQuery.direction, hasMore: false };
  const params = new URLSearchParams({ limit: String(listQuery.limit), page: String(listQuery.page), sort: listQuery.sort, direction: listQuery.direction });
  if (listQuery.query) params.set("q", listQuery.query);
  if (lifecycle) params.set("status", lifecycle);
  const resource = await requestOptional<AdminPlaceResource>(createAdminApiClient(request), `/api/v1/admin/map/places?${params.toString()}`);
  return { session, places: resource.data?.places ?? [], status: resource.status, denied: resource.status === "denied", canWrite: hasAdminPermission(session, "map.places.manage"), query: listQuery.query, lifecycle, page: resource.data?.page ?? listQuery.page, limit: listQuery.limit, sort: listQuery.sort, direction: listQuery.direction, hasMore: resource.data?.hasMore ?? false, message: resource.message };
}

function tone(status: string | null): "success" | "warning" | "neutral" {
  if (status === "active" || status === "fresh" || status === "visible") return "success";
  if (status === "stale" || status === "failed" || status === "under_review" || status === "candidate") return "warning";
  return "neutral";
}

function coordinate(place: AdminPlace): string {
  if (place.displayLatitude === null || place.displayLongitude === null) return "—";
  return `${place.displayLatitude.toFixed(5)}, ${place.displayLongitude.toFixed(5)}`;
}

function timestamp(value: string | null): string { return value ? new Date(value).toLocaleString("en-GB") : "—"; }

export default function MapPlacesRoute() {
  const data = useLoaderData() as MapPlacesLoaderData;
  if (data.denied) return <Card className="admin-panel"><h1>Place registry</h1><p className="admin-muted">บัญชีนี้ไม่มี platform permission สำหรับอ่าน canonical Place registry</p></Card>;
  const columns: AdminListColumn<AdminPlace>[] = [
    { key: "place", label: "Place", sortable: true, render: (place) => <div className="admin-table-primary"><span className="admin-application-icon"><MapPinned size={15} aria-hidden="true" /></span><span><strong>{place.name}</strong><small>{place.slug} · {place.categoryId}</small><small className="admin-code">{place.placeId}</small></span></div>, exportValue: (place) => `${place.name} · ${place.slug} · ${place.placeId}` },
    { key: "status", label: "Lifecycle", sortable: true, render: (place) => <StatusBadge tone={tone(place.status)}>{place.status}</StatusBadge>, exportValue: (place) => place.status },
    { key: "coordinates", label: "Display point", render: (place) => <span className="admin-code">{coordinate(place)}</span>, exportValue: coordinate },
    { key: "projection", label: "Projection", sortable: true, render: (place) => <div className="admin-table-primary"><StatusBadge tone={tone(place.projectionStatus)}>{place.projectionStatus ?? "not built"}</StatusBadge><small>{place.freshnessState ?? "unknown"} · {place.projectionVersion ?? "—"}</small></div>, exportValue: (place) => `${place.projectionStatus ?? "not built"} · ${place.freshnessState ?? "unknown"}` },
    { key: "revision", label: "Revision", sortable: true, render: (place) => <span className="admin-code">r{place.revision} · {place.sourceRevision}</span>, exportValue: (place) => `r${place.revision} · ${place.sourceRevision}` },
    { key: "generated", label: "Generated", sortable: true, render: (place) => timestamp(place.projectionGeneratedAt), exportValue: (place) => place.projectionGeneratedAt ?? "" },
    { key: "action", label: "Action", render: (place) => data.canWrite ? <Link className="admin-text-link" to={`/map/places/${encodeURIComponent(place.placeId)}`}>แก้ไข / ลบ</Link> : <span className="admin-muted">อ่านอย่างเดียว</span>, exportValue: () => "" }
  ];
  return (
    <>
      <section className="admin-page-heading"><div><span className="admin-eyebrow">Map / canonical registry</span><h1>Place registry</h1><p>ตรวจและแก้ canonical Place, source revision และ public projection ผ่าน Core API boundary</p></div><div className="admin-page-heading__actions"><StatusBadge tone={data.canWrite ? "success" : "info"}>{data.canWrite ? "Manage enabled" : "Read-only"}</StatusBadge><Link className="aevo-button aevo-button--ghost" to="/audit-logs?app=CORE">ดู audit</Link></div></section>
      {data.status !== "connected" ? <OfflineState title="Place registry ยังไม่พร้อมใช้งาน" description={data.message ?? "Core API ยังไม่ส่ง canonical registry กลับมา"} action={<Link className="aevo-button aevo-button--secondary" to="/connections">ตรวจ Connections</Link>} /> : null}
      <AdminListStandard listKey="map-places" caption="Canonical Place registry" rows={data.places} columns={columns} getRowId={(place) => place.placeId} emptyMessage="ยังไม่มี Place registry rows หรือไม่พบผลลัพธ์ตามตัวกรอง" query={data.query} placeholder="ชื่อหรือ slug" filters={[{ name: "status", label: "Lifecycle", value: data.lifecycle, options: [{ value: "", label: "ทุกสถานะ" }, { value: "candidate", label: "candidate" }, { value: "visible", label: "visible" }, { value: "limited", label: "limited" }, { value: "under_review", label: "under_review" }, { value: "closed", label: "closed" }, { value: "removed", label: "removed" }, { value: "merged", label: "merged" }] }]} page={data.page} limit={data.limit} hasMore={data.hasMore} sort={data.sort} direction={data.direction} />
    </>
  );
}
