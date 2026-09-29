import { ClipboardList } from "lucide-react";
import { Card, OfflineState, StatusBadge } from "@aevocado/design-system";
import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { AdminListStandard, type AdminListColumn } from "../components/admin-list-standard";
import { requestOptional, type DataSourceStatus } from "../lib/admin-resilience.server";
import { parseAdminListQuery, type AdminListDirection } from "../lib/admin-list-query";
import { createAdminApiClient, requireAdminAccess } from "../lib/auth.server";
import { hasAdminPermission, type AdminLoaderData } from "../lib/auth.shared";

interface AdminPlaceWorkflow {
  workflowId: string;
  aggregateType: "claim" | "submission" | "relationship";
  placeId: string | null;
  organizationId: string | null;
  actorId: string | null;
  status: string;
  submittedAt: string;
  reviewedAt: string | null;
  evidenceCount: number;
  requestedFields: string[];
  summary: Record<string, unknown>;
}

interface AdminPlaceWorkflowResource { success: true; workflows: AdminPlaceWorkflow[]; page: number; limit: number; hasMore: boolean; readOnly: true; reviewActionsEnabled: false; requestId?: string; }

interface MapWorkflowsLoaderData {
  session: AdminLoaderData;
  workflows: AdminPlaceWorkflow[];
  status: DataSourceStatus;
  denied: boolean;
  query: string;
  kind: string;
  lifecycle: string;
  page: number;
  limit: number;
  sort: string;
  direction: AdminListDirection;
  hasMore: boolean;
  message?: string;
}

export async function loader({ request }: LoaderFunctionArgs): Promise<MapWorkflowsLoaderData> {
  const session = await requireAdminAccess(request);
  const url = new URL(request.url);
  const listQuery = parseAdminListQuery(url, "submittedAt", "desc");
  const kind = url.searchParams.get("kind")?.trim() ?? "";
  const lifecycle = url.searchParams.get("status")?.trim() ?? "";
  if (session.connection !== "connected") return { session, workflows: [], status: session.connection, denied: false, query: listQuery.query, kind, lifecycle, page: listQuery.page, limit: listQuery.limit, sort: listQuery.sort, direction: listQuery.direction, hasMore: false, message: session.connectionMessage };
  if (!hasAdminPermission(session, "map.places.read")) return { session, workflows: [], status: "denied", denied: true, query: listQuery.query, kind, lifecycle, page: listQuery.page, limit: listQuery.limit, sort: listQuery.sort, direction: listQuery.direction, hasMore: false };
  const params = new URLSearchParams({ limit: String(listQuery.limit), page: String(listQuery.page), sort: listQuery.sort, direction: listQuery.direction });
  if (listQuery.query) params.set("q", listQuery.query);
  if (kind) params.set("kind", kind);
  if (lifecycle) params.set("status", lifecycle);
  const resource = await requestOptional<AdminPlaceWorkflowResource>(createAdminApiClient(request), `/api/v1/admin/map/workflows?${params.toString()}`);
  return { session, workflows: resource.data?.workflows ?? [], status: resource.status, denied: resource.status === "denied", query: listQuery.query, kind, lifecycle, page: resource.data?.page ?? listQuery.page, limit: listQuery.limit, sort: listQuery.sort, direction: listQuery.direction, hasMore: resource.data?.hasMore ?? false, message: resource.message };
}

function tone(status: string): "success" | "warning" | "neutral" { return ["approved", "active", "applied"].includes(status) ? "success" : ["pending", "proposed", "needs_info", "under_review"].includes(status) ? "warning" : "neutral"; }
function timestamp(value: string | null): string { return value ? new Date(value).toLocaleString("en-GB") : "—"; }
function summaryText(summary: Record<string, unknown>): string { const type = typeof summary.relationshipType === "string" ? summary.relationshipType : typeof summary.submissionType === "string" ? summary.submissionType : null; const target = typeof summary.targetId === "string" ? summary.targetId : null; return [type, target].filter(Boolean).join(" · ") || "review metadata"; }

export default function MapWorkflowsRoute() {
  const data = useLoaderData() as MapWorkflowsLoaderData;
  if (data.denied) return <Card className="admin-panel"><h1>Place workflows</h1><p className="admin-muted">บัญชีนี้ไม่มี platform permission สำหรับอ่าน workflow queue</p></Card>;
  const columns: AdminListColumn<AdminPlaceWorkflow>[] = [
    { key: "workflow", label: "Workflow", sortable: true, render: (workflow) => <div className="admin-table-primary"><span className="admin-application-icon"><ClipboardList size={15} aria-hidden="true" /></span><span><strong>{workflow.aggregateType}</strong><small className="admin-code">{workflow.workflowId}</small></span></div>, exportValue: (workflow) => `${workflow.aggregateType} · ${workflow.workflowId}` },
    { key: "place", label: "Place", render: (workflow) => <span className="admin-code">{workflow.placeId ?? "new Place"}</span>, exportValue: (workflow) => workflow.placeId ?? "new Place" },
    { key: "status", label: "Status", sortable: true, render: (workflow) => <StatusBadge tone={tone(workflow.status)}>{workflow.status}</StatusBadge>, exportValue: (workflow) => workflow.status },
    { key: "evidence", label: "Evidence", sortable: true, render: (workflow) => workflow.evidenceCount, exportValue: (workflow) => String(workflow.evidenceCount) },
    { key: "submitted", label: "Submitted", sortable: true, render: (workflow) => timestamp(workflow.submittedAt), exportValue: (workflow) => workflow.submittedAt },
    { key: "summary", label: "Summary", render: (workflow) => <span className="admin-code">{summaryText(workflow.summary)}</span>, exportValue: (workflow) => summaryText(workflow.summary) }
  ];
  return (
    <>
      <section className="admin-page-heading"><div><span className="admin-eyebrow">Map / review queue</span><h1>Place workflows</h1><p>ดู claim, community submission และ relationship ที่รอการ review จาก Core boundary</p></div><div className="admin-page-heading__actions"><StatusBadge tone="info">Read-only</StatusBadge><Link className="aevo-button aevo-button--ghost" to="/map/places">ดู registry</Link></div></section>
      {data.status !== "connected" ? <OfflineState title="Place workflow queue ยังไม่พร้อมใช้งาน" description={data.message ?? "Core API ยังไม่ส่ง workflow queue กลับมา"} action={<Link className="aevo-button aevo-button--secondary" to="/connections">ตรวจ Connections</Link>} /> : null}
      <AdminListStandard listKey="map-workflows" caption="Place workflow review queue" rows={data.workflows} columns={columns} getRowId={(workflow) => workflow.workflowId} emptyMessage="ยังไม่มี workflow หรือไม่พบผลลัพธ์ตามตัวกรอง" query={data.query} placeholder="ค้นหา workflow" filters={[{ name: "kind", label: "Workflow type", value: data.kind, options: [{ value: "", label: "ทั้งหมด" }, { value: "claim", label: "claim" }, { value: "submission", label: "submission" }, { value: "relationship", label: "relationship" }] }, { name: "status", label: "Status", value: data.lifecycle, options: [{ value: "", label: "ทุกสถานะ" }, { value: "pending", label: "pending" }, { value: "proposed", label: "proposed" }, { value: "approved", label: "approved" }, { value: "rejected", label: "rejected" }, { value: "applied", label: "applied" }] }]} page={data.page} limit={data.limit} hasMore={data.hasMore} sort={data.sort} direction={data.direction} />
    </>
  );
}
