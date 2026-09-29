import { ApiClientError } from "@aevocado/contracts";
import { Card, Input, StatusBadge } from "@aevocado/design-system";
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requestOptional, type DataSourceStatus } from "../lib/admin-resilience.server";
import { createAdminApiClient, requestCsrfHeaders, requireAdminAccess } from "../lib/auth.server";
import { normalizeApplications, type AdminApplication } from "../lib/application-registry";
import { hasAdminPermission, type AdminLoaderData } from "../lib/auth.shared";

interface ApplicationLoaderData {
  session: AdminLoaderData;
  application: AdminApplication | null;
  status: DataSourceStatus;
  denied: boolean;
  canManage: boolean;
  message?: string;
}

interface ApplicationActionData {
  ok: false;
  message: string;
}

export async function loader({ request, params }: LoaderFunctionArgs): Promise<ApplicationLoaderData> {
  const session = await requireAdminAccess(request);
  const code = (params.code ?? "").toUpperCase();
  const canManage = hasAdminPermission(session, "system.jobs");
  if (session.connection !== "connected") return { session, application: null, status: session.connection, denied: false, canManage, message: session.connectionMessage };
  if (!hasAdminPermission(session, "system.health")) return { session, application: null, status: "denied", denied: true, canManage: false };
  const resource = await requestOptional<{ success: true; applications: Array<{ code: AdminApplication["code"]; name: string; kind: string; status: string; manifestVersion?: string; ownerRepository?: string; contractVersion?: string; audience?: string; installScope?: string; storeScoped?: boolean; launchPath?: string; lifecycleStatus?: string; capabilities?: string[]; configSchemaRefs?: string[]; createdAt?: string; updatedAt?: string }> }>(createAdminApiClient(request), "/api/v1/admin/applications");
  const application = resource.data ? normalizeApplications(resource.data.applications).find((item) => item.code === code) ?? null : null;
  return { session, application, status: resource.status, denied: resource.status === "denied", canManage, message: resource.message };
}

export async function action({ request, params }: ActionFunctionArgs): Promise<Response | ApplicationActionData> {
  const session = await requireAdminAccess(request);
  if (session.connection !== "connected") return { ok: false, message: "Core API ยังไม่เชื่อมต่อ" };
  if (!hasAdminPermission(session, "system.jobs")) return { ok: false, message: "บัญชีนี้ไม่มีสิทธิ์ควบคุม application" };
  const form = await request.formData();
  const status = String(form.get("status") ?? "").trim().toUpperCase();
  const reason = String(form.get("reason") ?? "").trim();
  if (status !== "ACTIVE" && status !== "DISABLED") return { ok: false, message: "สถานะ application ไม่ถูกต้อง" };
  if (reason.length < 3) return { ok: false, message: "กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร" };
  try {
    await createAdminApiClient(request).requestJson(`/api/v1/admin/applications/${encodeURIComponent((params.code ?? "").toUpperCase())}`, {
      method: "PATCH",
      headers: requestCsrfHeaders(request),
      body: { status, reason }
    });
    return redirect(`/applications/${encodeURIComponent((params.code ?? "").toUpperCase())}`);
  } catch (error) {
    return { ok: false, message: error instanceof ApiClientError ? error.message : "เปลี่ยนสถานะ application ไม่สำเร็จ" };
  }
}

export default function ApplicationDetailRoute() {
  const data = useLoaderData() as ApplicationLoaderData;
  const actionData = useActionData() as ApplicationActionData | undefined;
  const navigation = useNavigation();
  if (data.denied) return <Card className="admin-panel"><h1>Application detail</h1><p className="admin-muted">บัญชีนี้ไม่มีสิทธิ์อ่าน application registry</p></Card>;
  if (data.status !== "connected") return <Card className="admin-panel"><h1>Application detail</h1><p className="admin-muted">{data.message ?? "Core API ยังไม่พร้อมใช้งาน"}</p><Link className="aevo-button aevo-button--ghost" to="/applications">กลับ registry</Link></Card>;
  if (!data.application) return <Card className="admin-panel"><h1>ไม่พบ Application</h1><Link className="aevo-button aevo-button--ghost" to="/applications">กลับ registry</Link></Card>;
  const application = data.application;
  const nextStatus = application.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
  const busy = navigation.state !== "idle";
  return (
    <>
      <section className="admin-page-heading"><div><span className="admin-eyebrow">Application boundary</span><h1>{application.name}</h1><p>Registry metadata เป็น Core-owned contract; การเปิด/ปิดเป็น privileged action เท่านั้น</p></div><Link className="aevo-button aevo-button--ghost" to="/applications">กลับ registry</Link></section>
      {actionData?.ok === false ? <p className="admin-inline-error" role="alert">{actionData.message}</p> : null}
      <Card className="admin-panel"><div className="admin-detail-grid"><div><span className="admin-eyebrow">Code</span><p className="admin-code">{application.code}</p></div><div><span className="admin-eyebrow">Kind</span><p>{application.kind}</p></div><div><span className="admin-eyebrow">Registry status</span><StatusBadge tone={application.status === "ACTIVE" ? "success" : application.status === "DISABLED" ? "danger" : "warning"}>{application.status}</StatusBadge></div><div><span className="admin-eyebrow">Manifest</span><p>{application.manifestVersion ?? "—"}</p></div><div><span className="admin-eyebrow">Owner repository</span><p className="admin-code">{application.ownerRepository ?? "—"}</p></div><div><span className="admin-eyebrow">Contract</span><p>{application.contractVersion ?? "—"}</p></div><div><span className="admin-eyebrow">Audience</span><p>{application.audience ?? "—"}</p></div><div><span className="admin-eyebrow">Launch path</span><p className="admin-code">{application.launchPath ?? "—"}</p></div></div></Card>
      <Card className="admin-panel"><h2>Lifecycle action</h2><p className="admin-muted">Admin boundary ไม่อนุญาตให้สร้างหรือลบ arbitrary application; ใช้ registry migration สำหรับโครงสร้าง และใช้ action นี้เฉพาะเปิด/ปิดพร้อม audit reason</p>{data.canManage && application.code !== "ADMIN" ? <Form method="post" className="admin-detail-form"><input type="hidden" name="status" value={nextStatus} /><label className="admin-go-field admin-detail-form__wide"><span>เหตุผล / ticket</span><Input name="reason" minLength={3} maxLength={500} required disabled={busy} placeholder="เช่น OPS-1234: disable degraded app" /></label><button className={`aevo-button ${nextStatus === "DISABLED" ? "aevo-button--danger" : "aevo-button--primary"}`} type="submit" disabled={busy}>{busy ? "กำลังบันทึก…" : nextStatus === "DISABLED" ? "ปิด application" : "เปิด application"}</button></Form> : <p className="admin-muted">{application.code === "ADMIN" ? "Admin boundary ถูกป้องกันไม่ให้ปิดจากตัวเอง" : "บัญชีนี้ไม่มี system.jobs"}</p>}</Card>
    </>
  );
}
