import { ScrollText } from "lucide-react";
import { Card, EmptyState, OfflineState, StatusBadge } from "@aevocado/design-system";
import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { isApplicationCode, type ApplicationCode } from "@aevocado/api-contract";
import { AdminListStandard, type AdminListColumn } from "../components/admin-list-standard";
import { requestOptional, type DataSourceStatus } from "../lib/admin-resilience.server";
import { parseAdminListQuery, type AdminListDirection } from "../lib/admin-list-query";
import { knownApplications } from "../lib/application-registry";
import { createAdminApiClient, requireAdminAccess } from "../lib/auth.server";
import { hasAdminPermission, type AdminLoaderData } from "../lib/auth.shared";

type AuditApplication = ApplicationCode | "PLATFORM";
interface RawAdminAuditLog { id: string; organizationId?: string | null; adminUserId?: string | null; platformRole?: string | null; action: string; targetType: string; targetId?: string | null; reason?: string | null; metadata?: Record<string, unknown> | null; createdAt: string; applicationCode?: string | null; }
interface AdminAuditLog extends RawAdminAuditLog { application: AuditApplication; }
interface AuditLogsLoaderData { session: AdminLoaderData; logs: AdminAuditLog[]; nextCursor: string | null; status: DataSourceStatus; denied: boolean; applicationFilter: AuditApplication | "ALL"; query: string; limit: number; page: number; hasMore: boolean; direction: AdminListDirection; message?: string; }

function inferApplication(log: RawAdminAuditLog): AuditApplication { const metadataApplication = log.applicationCode ?? log.metadata?.applicationCode; if (isApplicationCode(metadataApplication)) return metadataApplication; if (log.targetType === "application" && isApplicationCode(log.targetId)) return log.targetId; return "PLATFORM"; }
function applicationLabel(application: AuditApplication): string { return application === "PLATFORM" ? "Platform / cross-app" : knownApplications.find((item) => item.code === application)?.name ?? application; }
function dateLabel(value: string): string { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toISOString().replace("T", " ").slice(0, 16); }

export async function loader({ request }: LoaderFunctionArgs): Promise<AuditLogsLoaderData> {
  const url = new URL(request.url);
  const listQuery = parseAdminListQuery(url, "createdAt", "desc");
  const rawFilter = url.searchParams.get("app")?.toUpperCase() ?? "ALL";
  const applicationFilter: AuditApplication | "ALL" = rawFilter === "PLATFORM" || isApplicationCode(rawFilter) ? rawFilter : "ALL";
  const session = await requireAdminAccess(request);
  if (session.connection !== "connected") return { session, logs: [], nextCursor: null, status: session.connection, denied: false, applicationFilter, query: listQuery.query, limit: listQuery.limit, page: 1, hasMore: false, direction: listQuery.direction, message: session.connectionMessage };
  if (!hasAdminPermission(session, "audit.read")) return { session, logs: [], nextCursor: null, status: "denied", denied: true, applicationFilter, query: listQuery.query, limit: listQuery.limit, page: 1, hasMore: false, direction: listQuery.direction };
  const params = new URLSearchParams({ limit: String(listQuery.limit) });
  if (applicationFilter !== "ALL") params.set("app", applicationFilter);
  if (listQuery.query) params.set("q", listQuery.query);
  const cursor = url.searchParams.get("cursor")?.trim();
  if (cursor) params.set("cursor", cursor);
  const resource = await requestOptional<{ success: true; logs: RawAdminAuditLog[]; nextCursor?: string | null }>(createAdminApiClient(request), `/api/v1/admin/audit-logs?${params.toString()}`);
  const logs = (resource.data?.logs ?? []).map((log) => ({ ...log, application: inferApplication(log) }));
  const filteredLogs = applicationFilter === "ALL" ? logs : logs.filter((log) => log.application === applicationFilter);
  return { session, logs: filteredLogs, nextCursor: resource.data?.nextCursor ?? null, status: resource.status, denied: resource.status === "denied", applicationFilter, query: listQuery.query, limit: listQuery.limit, page: cursor ? 2 : 1, hasMore: Boolean(resource.data?.nextCursor), direction: listQuery.direction, message: resource.message };
}

export default function AuditLogsRoute() {
  const data = useLoaderData() as AuditLogsLoaderData;
  if (data.denied) return <Card className="admin-panel"><h1>Audit logs</h1><p className="admin-muted">บัญชีนี้ไม่มี `audit.read` จึงไม่สามารถอ่าน immutable platform audit logs ได้</p></Card>;
  const selectedLabel = data.applicationFilter === "ALL" ? "All applications" : applicationLabel(data.applicationFilter);
  const nextPageParams = new URLSearchParams({ limit: String(data.limit) });
  if (data.applicationFilter !== "ALL") nextPageParams.set("app", data.applicationFilter);
  if (data.query) nextPageParams.set("q", data.query);
  if (data.nextCursor) nextPageParams.set("cursor", data.nextCursor);
  const firstPageParams = new URLSearchParams({ limit: String(data.limit) });
  if (data.applicationFilter !== "ALL") firstPageParams.set("app", data.applicationFilter);
  if (data.query) firstPageParams.set("q", data.query);
  const columns: AdminListColumn<AdminAuditLog>[] = [
    { key: "time", label: "Time", render: (log) => <span className="admin-code">{dateLabel(log.createdAt)}</span>, exportValue: (log) => log.createdAt },
    { key: "application", label: "Application", render: (log) => <StatusBadge tone={log.application === "PLATFORM" ? "neutral" : "info"}>{applicationLabel(log.application)}</StatusBadge>, exportValue: (log) => applicationLabel(log.application) },
    { key: "action", label: "Action", render: (log) => <strong>{log.action}</strong>, exportValue: (log) => log.action },
    { key: "target", label: "Target", render: (log) => <span className="admin-code">{log.targetType}{log.targetId ? ` · ${log.targetId}` : ""}</span>, exportValue: (log) => `${log.targetType}${log.targetId ? ` · ${log.targetId}` : ""}` },
    { key: "actor", label: "Actor", render: (log) => <span className="admin-code">{log.adminUserId ?? "System"}{log.platformRole ? ` · ${log.platformRole}` : ""}</span>, exportValue: (log) => `${log.adminUserId ?? "System"}${log.platformRole ? ` · ${log.platformRole}` : ""}` },
    { key: "reason", label: "Reason", render: (log) => log.reason || "System/Admin action", exportValue: (log) => log.reason || "System/Admin action" }
  ];
  return (
    <>
      <section className="admin-page-heading"><div><span className="admin-eyebrow">Immutable activity</span><h1>Audit logs</h1><p>เหตุการณ์สำคัญจาก Core API แยกตาม app boundary ได้ โดย log ที่ไม่มี app code จะถูกระบุเป็น platform / cross-app อย่างชัดเจน</p></div><StatusBadge tone={data.status === "connected" ? "success" : "warning"}>{data.status === "connected" ? `${data.logs.length} events` : "Audit source unavailable"}</StatusBadge></section>
      {data.status !== "connected" ? <OfflineState title="Audit source ยังไม่เชื่อมต่อ" description={data.message ?? "เมื่อ Core API มี endpoint audit logs แล้ว หน้านี้จะแสดงข้อมูลจริงโดยไม่ใช้ sample records"} action={<Link className="aevo-button aevo-button--secondary" to="/connections">ดู Connections</Link>} /> : null}
      {data.status === "connected" && data.logs.length === 0 ? <EmptyState title="ยังไม่มี audit events สำหรับ filter นี้" description={`ตัวกรองปัจจุบัน: ${selectedLabel}`} action={<Link className="aevo-button aevo-button--secondary" to="/audit-logs">แสดงทั้งหมด</Link>} /> : null}
      <AdminListStandard listKey="audit-logs" caption="Platform audit logs" rows={data.logs} columns={columns} getRowId={(log) => log.id} emptyMessage="ยังไม่มี audit events สำหรับ filter นี้" query={data.query} placeholder="action, target, actor หรือ reason" filters={[{ name: "app", label: "Application", value: data.applicationFilter, options: [{ value: "ALL", label: "All applications" }, { value: "PLATFORM", label: "Platform / cross-app" }, ...knownApplications.map((application) => ({ value: application.code, label: `${application.name} (${application.code})` }))] }]} page={data.page} limit={data.limit} hasMore={data.hasMore} sort="createdAt" direction={data.direction} nextPageHref={data.nextCursor ? `/audit-logs?${nextPageParams.toString()}` : undefined} previousPageHref={data.page > 1 ? `/audit-logs?${firstPageParams.toString()}` : undefined} />
      <p className="admin-muted admin-source-note"><ScrollText size={14} aria-hidden="true" /> Source: Core API `/api/v1/admin/audit-logs` · No local cache or fabricated entries · {selectedLabel}</p>
    </>
  );
}
