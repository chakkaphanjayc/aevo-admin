import { ApiClientError } from "@aevocado/contracts";
import { Card, StatusBadge } from "@aevocado/design-system";
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requestOptional, type DataSourceStatus } from "../lib/admin-resilience.server";
import { createAdminApiClient, requestCsrfHeaders, requireAdminAccess } from "../lib/auth.server";
import { hasAdminPermission, type AdminLoaderData } from "../lib/auth.shared";

interface UserDetail {
  id: string;
  email: string;
  displayName: string;
  status: string;
  memberships: Array<{ organizationName: string; role: string }>;
}

interface UserLoaderData {
  session: AdminLoaderData;
  user: UserDetail | null;
  status: DataSourceStatus;
  denied: boolean;
  canManage: boolean;
  message?: string;
}

interface UserActionData {
  ok: false;
  message: string;
}

export async function loader({ request, params }: LoaderFunctionArgs): Promise<UserLoaderData> {
  const session = await requireAdminAccess(request);
  const userId = params.userId ?? "";
  const canManage = hasAdminPermission(session, "user.manage");
  if (session.connection !== "connected") return { session, user: null, status: session.connection, denied: false, canManage, message: session.connectionMessage };
  if (!hasAdminPermission(session, "organization.read")) return { session, user: null, status: "denied", denied: true, canManage: false };
  const resource = await requestOptional<{ success: true; user: UserDetail }>(createAdminApiClient(request), `/api/v1/admin/users/${encodeURIComponent(userId)}`);
  return { session, user: resource.data?.user ?? null, status: resource.status, denied: resource.status === "denied", canManage, message: resource.message };
}

export async function action({ request, params }: ActionFunctionArgs): Promise<Response | UserActionData> {
  const session = await requireAdminAccess(request);
  if (session.connection !== "connected") return { ok: false, message: "Core API ยังไม่เชื่อมต่อ" };
  if (!hasAdminPermission(session, "user.manage")) return { ok: false, message: "บัญชีนี้ไม่มีสิทธิ์จัดการ identity" };
  const userId = params.userId ?? "";
  const form = await request.formData();
  const status = String(form.get("status") ?? "").trim().toUpperCase();
  const reason = String(form.get("reason") ?? "").trim();
  if (status !== "ACTIVE" && status !== "DISABLED") return { ok: false, message: "สถานะ user ไม่ถูกต้อง" };
  if (reason.length < 3) return { ok: false, message: "กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร" };
  try {
    await createAdminApiClient(request).requestJson(`/api/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: requestCsrfHeaders(request),
      body: { status, reason }
    });
    return redirect(`/users/${encodeURIComponent(userId)}`);
  } catch (error) {
    return { ok: false, message: error instanceof ApiClientError ? error.message : "เปลี่ยนสถานะ user ไม่สำเร็จ" };
  }
}

export default function UserDetailRoute() {
  const data = useLoaderData() as UserLoaderData;
  const actionData = useActionData() as UserActionData | undefined;
  const navigation = useNavigation();
  if (data.denied) return <Card className="admin-panel"><h1>User detail</h1><p className="admin-muted">บัญชีนี้ไม่มีสิทธิ์อ่าน user directory</p></Card>;
  if (data.status !== "connected") return <Card className="admin-panel"><h1>User detail</h1><p className="admin-muted">{data.message ?? "Core API ยังไม่พร้อมใช้งาน"}</p><Link className="aevo-button aevo-button--ghost" to="/users">กลับ directory</Link></Card>;
  if (!data.user) return <Card className="admin-panel"><h1>ไม่พบ User</h1><Link className="aevo-button aevo-button--ghost" to="/users">กลับ directory</Link></Card>;
  const busy = navigation.state !== "idle";
  const nextStatus = data.user.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
  return (
    <>
      <section className="admin-page-heading"><div><span className="admin-eyebrow">Identity control record</span><h1>{data.user.displayName || data.user.email}</h1><p>บัญชี identity และ membership แยกจาก platform role; การปิดใช้งานจะ revoke app sessions ที่ Core</p></div><Link className="aevo-button aevo-button--ghost" to="/users">กลับ directory</Link></section>
      {actionData?.ok === false ? <p className="admin-inline-error" role="alert">{actionData.message}</p> : null}
      <Card className="admin-panel"><div className="admin-detail-grid"><div><span className="admin-eyebrow">Email</span><p>{data.user.email}</p></div><div><span className="admin-eyebrow">Status</span><StatusBadge tone={data.user.status === "ACTIVE" ? "success" : "danger"}>{data.user.status}</StatusBadge></div><div><span className="admin-eyebrow">User id</span><p className="admin-code">{data.user.id}</p></div></div></Card>
      <Card className="admin-panel"><h2>Memberships</h2><div className="admin-tag-list">{data.user.memberships.length ? data.user.memberships.map((membership) => <span className="admin-tag" key={`${membership.organizationName}-${membership.role}`}>{membership.organizationName} · {membership.role}</span>) : <span className="admin-muted">No active memberships</span>}</div></Card>
      <Card className="admin-panel"><h2>Lifecycle action</h2><p className="admin-muted">การลบตัวตนถาวรไม่ได้เปิดจาก Admin เพื่อป้องกันการทำลาย audit/account source of truth; ใช้ ACTIVE/DISABLED และเหตุผลแทน</p>{data.canManage ? <Form method="post" className="admin-detail-form"><input type="hidden" name="status" value={nextStatus} /><label className="admin-go-field admin-detail-form__wide"><span>เหตุผล / ticket</span><textarea className="aevo-control admin-textarea" name="reason" minLength={3} maxLength={500} required disabled={busy} placeholder="เช่น SEC-1234: disable compromised identity" /></label><button className={`aevo-button ${nextStatus === "DISABLED" ? "aevo-button--danger" : "aevo-button--primary"}`} type="submit" disabled={busy}>{busy ? "กำลังบันทึก…" : nextStatus === "DISABLED" ? "ปิดใช้งาน user" : "เปิดใช้งาน user"}</button></Form> : <p className="admin-muted">บัญชีนี้ไม่มี user.manage</p>}</Card>
    </>
  );
}
