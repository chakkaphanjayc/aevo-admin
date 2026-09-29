import { useEffect, useRef, useState } from "react";
import { Boxes } from "lucide-react";
import { ApiClientError } from "@aevocado/contracts";
import { isApplicationCode, type ApplicationCode } from "@aevocado/api-contract";
import { Card, Input, OfflineState, StatusBadge } from "@aevocado/design-system";
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { AdminListStandard, type AdminListColumn } from "../components/admin-list-standard";
import { requestOptional, type DataSourceStatus } from "../lib/admin-resilience.server";
import { parseAdminListQuery, type AdminListDirection } from "../lib/admin-list-query";
import {
  disconnectedApplications,
  normalizeApplications,
  type AdminApplication
} from "../lib/application-registry";
import { createAdminApiClient, requestCsrfHeaders, requireAdminAccess } from "../lib/auth.server";
import { hasAdminPermission, type AdminLoaderData } from "../lib/auth.shared";

interface ApplicationsLoaderData {
  session: AdminLoaderData;
  applications: AdminApplication[];
  denied: boolean;
  status: DataSourceStatus;
  query: string;
  statusFilter: string;
  page: number;
  limit: number;
  sort: string;
  direction: AdminListDirection;
  hasMore: boolean;
  message?: string;
}

interface ApplicationsActionData {
  ok: false;
  message: string;
}

export async function loader({ request }: LoaderFunctionArgs): Promise<ApplicationsLoaderData> {
  const session = await requireAdminAccess(request);
  const url = new URL(request.url);
  const listQuery = parseAdminListQuery(url, "name", "asc");
  const query = listQuery.query;
  const statusFilter = url.searchParams.get("status")?.trim().toUpperCase() ?? "";
  if (session.connection !== "connected") {
    const fallback = disconnectedApplications().filter((application) => (!query || `${application.name} ${application.code}`.toLowerCase().includes(query.toLowerCase())) && (!statusFilter || application.status === statusFilter));
    const start = (listQuery.page - 1) * listQuery.limit;
    return {
      session,
      applications: fallback.slice(start, start + listQuery.limit),
      denied: false,
      status: session.connection,
      query,
      statusFilter,
      page: listQuery.page,
      limit: listQuery.limit,
      sort: listQuery.sort,
      direction: listQuery.direction,
      hasMore: start + listQuery.limit < fallback.length,
      message: session.connectionMessage
    };
  }
  if (!hasAdminPermission(session, "system.health")) return { session, applications: [], denied: true, status: "denied", query, statusFilter, page: listQuery.page, limit: listQuery.limit, sort: listQuery.sort, direction: listQuery.direction, hasMore: false };
  const api = createAdminApiClient(request);
  const resource = await requestOptional<{ success: true; applications: Array<{ code: ApplicationCode; name: string; kind: string; status: string; createdAt?: string; updatedAt?: string }> }>(api, "/api/v1/admin/applications");
  if (!resource.data) {
    const fallback = disconnectedApplications();
    const start = (listQuery.page - 1) * listQuery.limit;
    return {
      session,
      applications: fallback.slice(start, start + listQuery.limit),
      denied: resource.status === "denied",
      status: resource.status,
      query,
      statusFilter,
      page: listQuery.page,
      limit: listQuery.limit,
      sort: listQuery.sort,
      direction: listQuery.direction,
      hasMore: start + listQuery.limit < fallback.length,
      message: resource.message
    };
  }
  const filtered = normalizeApplications(resource.data.applications).filter((application) => (!query || `${application.name} ${application.code} ${application.kind}`.toLowerCase().includes(query.toLowerCase())) && (!statusFilter || application.status === statusFilter));
  const sorted = [...filtered].sort((left, right) => { const a = `${left.name} ${left.code}`.toLowerCase(); const b = `${right.name} ${right.code}`.toLowerCase(); return listQuery.direction === "asc" ? a.localeCompare(b) : b.localeCompare(a); });
  const start = (listQuery.page - 1) * listQuery.limit;
  return { session, applications: sorted.slice(start, start + listQuery.limit), denied: false, status: "connected", query, statusFilter, page: listQuery.page, limit: listQuery.limit, sort: listQuery.sort, direction: listQuery.direction, hasMore: start + listQuery.limit < sorted.length };
}

export async function action({ request }: ActionFunctionArgs): Promise<Response | ApplicationsActionData> {
  const session = await requireAdminAccess(request);
  if (session.connection !== "connected") {
    return { ok: false, message: "Core API ยังไม่เชื่อมต่อ จึงปิดการเปลี่ยนสถานะไว้ก่อน" };
  }
  if (!hasAdminPermission(session, "system.jobs")) return { ok: false, message: "บัญชีนี้ไม่มีสิทธิ์ควบคุมสถานะ application" };

  const form = await request.formData();
  const code = String(form.get("code") ?? "").toUpperCase();
  const status = String(form.get("status") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  if (!isApplicationCode(code)) return { ok: false, message: "ไม่พบ application code ที่ถูกต้อง" };
  if (status !== "ACTIVE" && status !== "DISABLED") return { ok: false, message: "สถานะ application ไม่ถูกต้อง" };
  if (reason.length < 3) return { ok: false, message: "กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร" };

  try {
    const api = createAdminApiClient(request);
    await api.requestJson<{ success: true }, { status: "ACTIVE" | "DISABLED"; reason: string }>(`/api/v1/admin/applications/${encodeURIComponent(code)}`, {
      method: "PATCH",
      headers: requestCsrfHeaders(request),
      body: { status, reason }
    });
    return redirect("/applications");
  } catch (error) {
    return { ok: false, message: error instanceof ApiClientError ? error.message : "ไม่สามารถเปลี่ยนสถานะ application ได้" };
  }
}

function HoldSubmitButton({ label, danger, disabled }: { label: string; danger: boolean; disabled: boolean }) {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const startedAt = useRef<number | null>(null);
  const interval = useRef<number | null>(null);

  function clearHold(): void {
    if (interval.current !== null) window.clearInterval(interval.current);
    interval.current = null;
    startedAt.current = null;
    setHolding(false);
    setProgress(0);
  }

  function startHold(form: HTMLFormElement | null): void {
    if (disabled || holding) return;
    setHolding(true);
    startedAt.current = performance.now();
    interval.current = window.setInterval(() => {
      const started = startedAt.current ?? performance.now();
      const next = Math.min((performance.now() - started) / 900, 1);
      setProgress(next);
      if (next >= 1) {
        clearHold();
        form?.requestSubmit();
      }
    }, 16);
  }

  useEffect(() => () => clearHold(), []);

  return (
    <button
      className={`admin-hold-button${danger ? " admin-hold-button--danger" : ""}`}
      type="button"
      disabled={disabled}
      aria-label={`Hold to ${label.toLowerCase()}`}
      aria-busy={holding}
      onPointerDown={(event) => startHold(event.currentTarget.form)}
      onPointerUp={clearHold}
      onPointerCancel={clearHold}
      onPointerLeave={clearHold}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && !holding) {
          event.preventDefault();
          startHold(event.currentTarget.form);
        }
      }}
      onKeyUp={(event) => {
        if (event.key === "Enter" || event.key === " ") clearHold();
      }}
    >
      <span className="admin-hold-button__progress" style={{ width: `${progress * 100}%` }} aria-hidden="true" />
      <span>{holding ? "ปล่อยเมื่อพร้อม…" : `กดค้างเพื่อ${label}`}</span>
    </button>
  );
}

export default function ApplicationsRoute() {
  const data = useLoaderData() as ApplicationsLoaderData;
  const actionData = useActionData() as ApplicationsActionData | undefined;
  const navigation = useNavigation();

  if (data.denied) {
    return <Card className="admin-panel"><h1>Application registry</h1><p className="admin-muted">บัญชีนี้มีสิทธิ์เข้า Aevo Admin แต่ไม่มีสิทธิ์อ่าน application registry</p></Card>;
  }

  const statusTone = data.status === "connected" ? "success" : data.status === "degraded" ? "warning" : "warning";

  return (
    <>
      <section className="admin-page-heading">
        <div><span className="admin-eyebrow">Control plane</span><h1>Applications</h1><p>สถานะของ first-party application boundary ทั้งหมดใน Aevo Ecosystem การปิดแอปเป็น privileged action และจะถูกบันทึก audit ทุกครั้ง</p></div>
        <StatusBadge tone={statusTone}>{data.status === "connected" ? `${data.applications.length} registered` : "Registry not connected"}</StatusBadge>
      </section>
      {data.status !== "connected" ? (
        <OfflineState
          title="ยังไม่เห็น application registry จาก Core API"
          description={data.message ?? "รายชื่อด้านล่างเป็น catalog ของ boundary ที่รู้จักเท่านั้น ยังไม่ใช่ข้อมูล runtime และ action ถูกปิดไว้"}
          action={<Link className="aevo-button aevo-button--secondary" to="/connections">ตรวจ Connections</Link>}
        />
      ) : null}
      {actionData?.ok === false ? <p className="admin-inline-error" role="alert">{actionData.message}</p> : null}
      <ApplicationsList data={data} navigationState={navigation.state} />
    </>
  );
}

function ApplicationsList({ data, navigationState }: { data: ApplicationsLoaderData; navigationState: "idle" | "submitting" | "loading" }) {
  const columns: AdminListColumn<AdminApplication>[] = [
    { key: "application", label: "Application", sortable: true, render: (application) => <div className="admin-table-primary"><span className="admin-application-icon"><Boxes size={15} aria-hidden="true" /></span><span><strong>{application.name}</strong><small>{application.code} · <Link className="admin-text-link" to={`/applications/${application.code}`}>รายละเอียด</Link> · <Link className="admin-text-link" to={`/audit-logs?app=${application.code}`}>audit</Link></small></span></div>, exportValue: (application) => `${application.name} · ${application.code}` },
    { key: "boundary", label: "Boundary", sortable: true, render: (application) => <span className="admin-code">{application.kind}</span>, exportValue: (application) => application.kind },
    { key: "registry", label: "Registry", sortable: true, render: (application) => <StatusBadge tone={application.status === "ACTIVE" ? "success" : application.status === "DISABLED" ? "danger" : "warning"}>{application.status}</StatusBadge>, exportValue: (application) => application.status },
    { key: "connection", label: "Connection", render: (application) => <StatusBadge tone={application.visibility === "VISIBLE" ? "success" : "warning"}>{application.visibility === "VISIBLE" ? "Registry visible" : "Not connected"}</StatusBadge>, exportValue: (application) => application.visibility },
    { key: "reason", label: "Reason", render: (application) => { const canControl = application.visibility === "VISIBLE" && application.status !== "UNKNOWN"; return <Input name="reason" form={`application-${application.code}`} placeholder="เหตุผล / ticket" maxLength={500} required aria-label={`Reason for ${application.name}`} disabled={!canControl || application.code === "ADMIN" || navigationState !== "idle"} />; }, exportValue: () => "" },
    { key: "control", label: "Control", render: (application) => { const nextStatus = application.status === "ACTIVE" ? "DISABLED" : "ACTIVE"; const canControl = application.visibility === "VISIBLE" && application.status !== "UNKNOWN"; return canControl ? <Form id={`application-${application.code}`} method="post" className="admin-inline-form"><input type="hidden" name="code" value={application.code} /><input type="hidden" name="status" value={nextStatus} /><HoldSubmitButton label={nextStatus === "ACTIVE" ? "เปิดใช้งาน" : "ปิดใช้งาน"} danger={nextStatus === "DISABLED"} disabled={application.code === "ADMIN" || navigationState !== "idle"} /></Form> : <span className="admin-muted">Read-only until connected</span>; }, exportValue: () => "" }
  ];
  return <AdminListStandard listKey="applications" caption="Application registry" rows={data.applications} columns={columns} getRowId={(application) => application.code} emptyMessage="ไม่พบ application ตามตัวกรอง" query={data.query} placeholder="ชื่อ, code หรือ boundary" filters={[{ name: "status", label: "สถานะ", value: data.statusFilter, options: [{ value: "", label: "ทุกสถานะ" }, { value: "ACTIVE", label: "ACTIVE" }, { value: "DISABLED", label: "DISABLED" }, { value: "UNKNOWN", label: "UNKNOWN" }] }]} page={data.page} limit={data.limit} hasMore={data.hasMore} sort={data.sort} direction={data.direction} />;
}
