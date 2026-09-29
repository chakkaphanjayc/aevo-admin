import { Cable, ExternalLink } from "lucide-react";
import { Card, OfflineState, StatusBadge } from "@aevocado/design-system";
import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { AdminListStandard, type AdminListColumn } from "../components/admin-list-standard";
import { requestOptional, type DataSourceStatus } from "../lib/admin-resilience.server";
import { parseAdminListQuery, type AdminListDirection } from "../lib/admin-list-query";
import { disconnectedApplications, normalizeApplications, normalizeConnections, type AdminApplication, type AdminApplicationConnection, type ApplicationRuntimeStatus } from "../lib/application-registry";
import { createAdminApiClient, requireAdminAccess } from "../lib/auth.server";
import { hasAdminPermission, type AdminLoaderData } from "../lib/auth.shared";

interface ConnectionsLoaderData {
  session: AdminLoaderData;
  applications: AdminApplication[];
  registryStatus: DataSourceStatus;
  connections: AdminApplicationConnection[];
  runtimeStatus: DataSourceStatus;
  denied: boolean;
  query: string;
  statusFilter: string;
  page: number;
  limit: number;
  sort: string;
  direction: AdminListDirection;
  hasMore: boolean;
  message?: string;
}

function statusTone(status: DataSourceStatus): "success" | "warning" | "danger" | "info" { return status === "connected" ? "success" : status === "denied" ? "danger" : "warning"; }
function registryTone(status: AdminApplication["status"]): "success" | "danger" | "warning" { return status === "ACTIVE" ? "success" : status === "DISABLED" ? "danger" : "warning"; }
function runtimeTone(status: ApplicationRuntimeStatus): "success" | "warning" | "danger" | "neutral" { return status === "connected" ? "success" : status === "degraded" ? "warning" : status === "not_connected" || status === "denied" ? "danger" : "neutral"; }
function runtimeLabel(status: ApplicationRuntimeStatus): string { return status === "connected" ? "Connected" : status === "degraded" ? "Degraded" : status === "not_connected" ? "Not connected" : status === "denied" ? "Permission denied" : status === "not_configured" ? "Not configured" : "Unavailable"; }
function dateLabel(value: string | null): string { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toISOString().replace("T", " ").slice(0, 16); }
function connectionResourceItems(resource: { items?: unknown; connections?: unknown } | null): Array<Record<string, unknown>> { const items = resource?.items ?? resource?.connections; return Array.isArray(items) ? items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : []; }

export async function loader({ request }: LoaderFunctionArgs): Promise<ConnectionsLoaderData> {
  const session = await requireAdminAccess(request);
  const url = new URL(request.url);
  const listQuery = parseAdminListQuery(url, "name", "asc");
  const statusFilter = url.searchParams.get("status")?.trim().toLowerCase() ?? "";
  if (session.connection !== "connected") return { session, applications: disconnectedApplications(), registryStatus: session.connection, connections: [], runtimeStatus: session.connection, denied: false, query: listQuery.query, statusFilter, page: listQuery.page, limit: listQuery.limit, sort: listQuery.sort, direction: listQuery.direction, hasMore: false, message: session.connectionMessage };
  if (!hasAdminPermission(session, "system.health")) return { session, applications: [], registryStatus: "denied", connections: [], runtimeStatus: "denied", denied: true, query: listQuery.query, statusFilter, page: listQuery.page, limit: listQuery.limit, sort: listQuery.sort, direction: listQuery.direction, hasMore: false };
  const api = createAdminApiClient(request);
  const [registryResource, connectionResource] = await Promise.all([
    requestOptional<{ success: true; applications: Array<{ code: AdminApplication["code"]; name: string; kind: string; status: string; createdAt?: string; updatedAt?: string }> }>(api, "/api/v1/admin/applications"),
    requestOptional<{ items?: unknown; connections?: unknown }>(api, "/api/v1/admin/connections")
  ]);
  const normalizedApplications = registryResource.data ? normalizeApplications(registryResource.data.applications) : disconnectedApplications();
  const normalizedConnections = normalizeConnections(connectionResourceItems(connectionResource.data));
  const filtered = normalizedApplications.filter((application) => (!listQuery.query || `${application.name} ${application.code} ${application.kind}`.toLowerCase().includes(listQuery.query.toLowerCase())) && (!statusFilter || normalizedConnections.some((connection) => connection.appCode === application.code && connection.status === statusFilter)));
  const sorted = [...filtered].sort((left, right) => { const a = `${left.name} ${left.code}`.toLowerCase(); const b = `${right.name} ${right.code}`.toLowerCase(); return (listQuery.direction === "asc" ? a.localeCompare(b) : b.localeCompare(a)); });
  const start = (listQuery.page - 1) * listQuery.limit;
  return { session, applications: sorted.slice(start, start + listQuery.limit), registryStatus: registryResource.status, connections: normalizedConnections, runtimeStatus: connectionResource.status, denied: registryResource.status === "denied" || connectionResource.status === "denied", query: listQuery.query, statusFilter, page: listQuery.page, limit: listQuery.limit, sort: listQuery.sort, direction: listQuery.direction, hasMore: start + listQuery.limit < sorted.length, message: registryResource.message ?? connectionResource.message };
}

export default function ConnectionsRoute() {
  const data = useLoaderData() as ConnectionsLoaderData;
  if (data.denied) return <Card className="admin-panel"><h1>Connections</h1><p className="admin-muted">บัญชีนี้ไม่มีสิทธิ์อ่าน application registry และสถานะการเชื่อมต่อ</p></Card>;
  const coreStatus = data.session.connection === "connected" && data.registryStatus === "connected" ? "connected" : data.registryStatus;
  const visibleCount = data.applications.filter((application) => application.visibility === "VISIBLE").length;
  const connectedRuntimeCount = data.connections.filter((connection) => connection.status === "connected").length;
  const connectionByCode = new Map(data.connections.map((connection) => [connection.appCode, connection]));
  const columns: AdminListColumn<AdminApplication>[] = [
    { key: "application", label: "Application", sortable: true, render: (application) => <div className="admin-table-primary"><span className="admin-application-icon"><Cable size={15} aria-hidden="true" /></span><span><strong>{application.name}</strong><small>{application.code}</small></span></div>, exportValue: (application) => `${application.name} · ${application.code}` },
    { key: "boundary", label: "Boundary", sortable: true, render: (application) => <span className="admin-code">{application.kind}</span>, exportValue: (application) => application.kind },
    { key: "registry", label: "Registry", sortable: true, render: (application) => <StatusBadge tone={registryTone(application.status)}>{application.status === "UNKNOWN" ? "Unknown" : application.status}</StatusBadge>, exportValue: (application) => application.status },
    { key: "runtime", label: "Runtime", render: (application) => { const connection = connectionByCode.get(application.code); return <div className="admin-table-stack"><StatusBadge tone={runtimeTone(connection?.status ?? "unknown")}>{runtimeLabel(connection?.status ?? "unknown")}</StatusBadge>{connection?.latencyMs !== null && connection?.latencyMs !== undefined ? <small>{connection.latencyMs} ms{connection.lastErrorCode ? ` · ${connection.lastErrorCode}` : ""}</small> : connection?.lastErrorCode ? <small>{connection.lastErrorCode}</small> : null}</div>; }, exportValue: (application) => runtimeLabel(connectionByCode.get(application.code)?.status ?? "unknown") },
    { key: "checked", label: "Checked", sortable: true, render: (application) => <span className="admin-code">{dateLabel(connectionByCode.get(application.code)?.checkedAt ?? null)}</span>, exportValue: (application) => connectionByCode.get(application.code)?.checkedAt ?? "" },
    { key: "audit", label: "Audit", render: (application) => <Link className="admin-text-link admin-inline-link" to={`/audit-logs?app=${application.code}`}>View logs <ExternalLink size={13} aria-hidden="true" /></Link>, exportValue: () => "" }
  ];
  return (
    <>
      <section className="admin-page-heading"><div><span className="admin-eyebrow">Control plane observability</span><h1>Connections</h1><p>หน้านี้แยก “เชื่อมต่อกับ Core API” ออกจาก “app ถูก register ใน registry” เพื่อไม่ให้สถานะ registry ถูกตีความว่า runtime ของแอปปลายทางทำงานอยู่</p></div><StatusBadge tone={statusTone(coreStatus)}>{coreStatus === "connected" ? `${visibleCount} visible` : "Not connected"}</StatusBadge></section>
      {coreStatus !== "connected" ? <OfflineState title="Core API ยังไม่พร้อมสำหรับการตรวจสอบ" description={data.message ?? "รายชื่อด้านล่างเป็น known application catalog เท่านั้น ยังไม่มีการยืนยันจาก runtime หรือ registry"} action={<a className="aevo-button aevo-button--secondary" href="/connections">ลองเชื่อมต่อใหม่</a>} /> : null}
      <section className="admin-connection-grid" aria-label="Connection summary"><Card className="admin-connection-card admin-connection-card--primary"><div className="admin-connection-card__icon"><Cable size={18} aria-hidden="true" /></div><div><span className="admin-eyebrow">Control plane</span><h2>Core API</h2><p>Session, RBAC, application registry และ audit source of truth</p></div><StatusBadge tone={statusTone(coreStatus)}>{coreStatus === "connected" ? "Connected" : coreStatus === "degraded" ? "Degraded" : "Not connected"}</StatusBadge><span className="admin-code">server-side endpoint · AEVO_API_URL</span></Card><Card className="admin-connection-card"><div><span className="admin-eyebrow">Runtime probes</span><h2>App health checks</h2><p>อ่านจาก Core API connection registry แยกจาก app registry; จะขึ้นสถานะเฉพาะเมื่อ probe เขียนผลตรวจจริง</p></div><StatusBadge tone={statusTone(data.runtimeStatus)}>{data.runtimeStatus === "connected" ? `${connectedRuntimeCount} connected` : runtimeLabel(data.runtimeStatus)}</StatusBadge></Card></section>
      <AdminListStandard listKey="connections" caption="Application connection map" rows={data.applications} columns={columns} getRowId={(application) => application.code} emptyMessage="ไม่พบ application ตามตัวกรอง" query={data.query} placeholder="ชื่อแอป, code หรือ URL" filters={[{ name: "status", label: "Runtime status", value: data.statusFilter, options: [{ value: "", label: "ทุกสถานะ" }, { value: "connected", label: "Connected" }, { value: "degraded", label: "Degraded" }, { value: "not_configured", label: "Not configured" }, { value: "not_connected", label: "Not connected" }] }]} page={data.page} limit={data.limit} hasMore={data.hasMore} sort={data.sort} direction={data.direction} />
      <p className="admin-muted admin-source-note">Registry: Core API `/api/v1/admin/applications` · Runtime: Core API `/api/v1/admin/connections` · ไม่มีการสร้าง health status เมื่อ probe ยังไม่ส่งข้อมูลจริง · รายการแอปที่แสดงมาจาก Core registry โดยตรง</p>
    </>
  );
}
