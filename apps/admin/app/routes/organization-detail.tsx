import { ApiClientError } from "@aevocado/contracts";
import { Card, Input, Select, StatusBadge } from "@aevocado/design-system";
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requestOptional, type DataSourceStatus } from "../lib/admin-resilience.server";
import { createAdminApiClient, requestCsrfHeaders, requireAdminAccess } from "../lib/auth.server";
import { hasAdminPermission, type AdminLoaderData } from "../lib/auth.shared";

interface OrganizationDetail {
  id: string;
  name: string;
  slug: string;
  status: string;
  storesCount: number;
  membersCount: number;
  createdAt: string;
  stores: Array<{ id: string; code: string; name: string; timezone: string; currency: string; status: string; createdAt: string }>;
  members: Array<{ membershipId: string; userId: string; email: string; displayName: string; role: string; status: string; createdAt: string }>;
}

interface OrganizationLoaderData {
  session: AdminLoaderData;
  organization: OrganizationDetail | null;
  organizationId: string;
  status: DataSourceStatus;
  denied: boolean;
  canManage: boolean;
  message?: string;
}

interface OrganizationActionData {
  ok: false;
  message: string;
}

export async function loader({ request, params }: LoaderFunctionArgs): Promise<OrganizationLoaderData> {
  const session = await requireAdminAccess(request);
  const organizationId = params.organizationId ?? "new";
  const canManage = hasAdminPermission(session, "organization.manage");
  if (session.connection !== "connected") return { session, organization: null, organizationId, status: session.connection, denied: false, canManage, message: session.connectionMessage };
  if (!hasAdminPermission(session, "organization.read")) return { session, organization: null, organizationId, status: "denied", denied: true, canManage: false };
  if (organizationId === "new") return { session, organization: null, organizationId, status: "connected", denied: false, canManage };
  const resource = await requestOptional<{ success: true; organization: OrganizationDetail }>(createAdminApiClient(request), `/api/v1/admin/organizations/${encodeURIComponent(organizationId)}`);
  return { session, organization: resource.data?.organization ?? null, organizationId, status: resource.status, denied: resource.status === "denied", canManage, message: resource.message };
}

export async function action({ request, params }: ActionFunctionArgs): Promise<Response | OrganizationActionData> {
  const session = await requireAdminAccess(request);
  if (session.connection !== "connected") return { ok: false, message: "Core API ยังไม่เชื่อมต่อ" };
  if (!hasAdminPermission(session, "organization.manage")) return { ok: false, message: "บัญชีนี้ไม่มีสิทธิ์จัดการองค์กร" };
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const slug = String(form.get("slug") ?? "").trim().toLowerCase();
  const status = String(form.get("status") ?? "ACTIVE").trim().toUpperCase();
  const ownerUserId = String(form.get("ownerUserId") ?? "").trim();
  const reason = String(form.get("reason") ?? "").trim();
  if (name.length < 1 || name.length > 160) return { ok: false, message: "กรุณาระบุชื่อองค์กร 1–160 ตัวอักษร" };
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) return { ok: false, message: "slug ต้องเป็นตัวอักษร a-z, ตัวเลข และขีดกลางเท่านั้น" };
  if (reason.length < 3) return { ok: false, message: "กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร" };
  if (params.organizationId !== "new" && status !== "ACTIVE" && status !== "SUSPENDED") return { ok: false, message: "สถานะองค์กรไม่ถูกต้อง" };
  if (params.organizationId === "new" && ownerUserId && !/^[0-9a-f-]{36}$/i.test(ownerUserId)) return { ok: false, message: "owner user id ไม่ถูกต้อง" };

  try {
    const api = createAdminApiClient(request);
    if (params.organizationId === "new") {
      await api.requestJson(`/api/v1/admin/organizations`, {
        method: "POST",
        headers: requestCsrfHeaders(request),
        body: { name, slug, ...(ownerUserId ? { ownerUserId } : {}), reason }
      });
      return redirect("/organizations");
    }
    await api.requestJson(`/api/v1/admin/organizations/${encodeURIComponent(params.organizationId ?? "")}`, {
      method: "PATCH",
      headers: requestCsrfHeaders(request),
      body: { name, slug, status, reason }
    });
    return redirect(`/organizations/${encodeURIComponent(params.organizationId ?? "")}`);
  } catch (error) {
    return { ok: false, message: error instanceof ApiClientError ? error.message : "บันทึกองค์กรไม่สำเร็จ" };
  }
}

function statusTone(status: string): "success" | "warning" | "danger" {
  return status === "ACTIVE" ? "success" : status === "SUSPENDED" ? "warning" : "danger";
}

export default function OrganizationDetailRoute() {
  const data = useLoaderData() as OrganizationLoaderData;
  const actionData = useActionData() as OrganizationActionData | undefined;
  const navigation = useNavigation();
  if (data.denied) return <Card className="admin-panel"><h1>Organization detail</h1><p className="admin-muted">บัญชีนี้ไม่มีสิทธิ์อ่านข้อมูลข้ามองค์กร</p></Card>;
  if (data.status !== "connected") return <Card className="admin-panel"><h1>Organization detail</h1><p className="admin-muted">{data.message ?? "Core API ยังไม่พร้อมใช้งาน"}</p><Link className="aevo-button aevo-button--ghost" to="/organizations">กลับ directory</Link></Card>;

  const isNew = data.organizationId === "new";
  const organization = data.organization;
  if (!isNew && !organization) return <Card className="admin-panel"><h1>ไม่พบ Organization</h1><p className="admin-muted">รายการอาจถูกระงับหรือไม่มีอยู่ใน Core</p><Link className="aevo-button aevo-button--ghost" to="/organizations">กลับ directory</Link></Card>;
  const busy = navigation.state !== "idle";
  return (
    <>
      <section className="admin-page-heading"><div><span className="admin-eyebrow">Organization control record</span><h1>{isNew ? "สร้าง Organization" : organization?.name}</h1><p>{isNew ? "สร้าง tenant ผ่าน Core API พร้อม owner membership, Hub assignment, installation และ billing projection เริ่มต้น" : "ดูรายละเอียด stores/members และเปลี่ยน lifecycle ด้วยเหตุผลที่บันทึก audit"}</p></div><Link className="aevo-button aevo-button--ghost" to="/organizations">กลับ directory</Link></section>
      {actionData?.ok === false ? <p className="admin-inline-error" role="alert">{actionData.message}</p> : null}
      <Card className="admin-panel">
        <Form method="post" className="admin-detail-form">
          <label className="admin-go-field"><span>ชื่อองค์กร</span><Input name="name" defaultValue={organization?.name ?? ""} maxLength={160} required disabled={!data.canManage || busy} /></label>
          <label className="admin-go-field"><span>Slug</span><Input name="slug" defaultValue={organization?.slug ?? ""} maxLength={63} required disabled={!data.canManage || busy} /></label>
          {isNew ? <label className="admin-go-field"><span>Owner user id (ถ้าเว้นว่างจะใช้ผู้สร้าง)</span><Input name="ownerUserId" placeholder={data.session.me?.user.id ?? "UUID ของ Accounts identity"} disabled={!data.canManage || busy} /></label> : <label className="admin-go-field"><span>Lifecycle</span><Select name="status" defaultValue={organization?.status ?? "ACTIVE"} disabled={!data.canManage || busy}><option value="ACTIVE">ACTIVE</option><option value="SUSPENDED">SUSPENDED</option></Select></label>}
          <label className="admin-go-field admin-detail-form__wide"><span>เหตุผล / ticket (จำเป็นสำหรับ audit)</span><textarea className="aevo-control admin-textarea" name="reason" minLength={3} maxLength={500} required disabled={!data.canManage || busy} placeholder="เช่น OPS-1234: update tenant lifecycle" /></label>
          {data.canManage ? <button className="aevo-button aevo-button--primary" type="submit" disabled={busy}>{busy ? "กำลังบันทึก…" : isNew ? "สร้างองค์กร" : "บันทึกการเปลี่ยนแปลง"}</button> : <p className="admin-muted">บัญชีนี้อ่านรายละเอียดได้ แต่ไม่มี organization.manage</p>}
        </Form>
      </Card>
      {!isNew && organization ? <>
        <section className="admin-stat-grid"><Card><span className="admin-eyebrow">Lifecycle</span><StatusBadge tone={statusTone(organization.status)}>{organization.status}</StatusBadge></Card><Card><span className="admin-eyebrow">Stores</span><strong>{organization.storesCount}</strong></Card><Card><span className="admin-eyebrow">Members</span><strong>{organization.membersCount}</strong></Card><Card><span className="admin-eyebrow">Created</span><strong>{new Date(organization.createdAt).toLocaleDateString("en-GB")}</strong></Card></section>
        <Card className="admin-panel"><h2>Stores</h2><div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>Code</th><th>Name</th><th>Timezone</th><th>Currency</th><th>Status</th></tr></thead><tbody>{organization.stores.map((store) => <tr key={store.id}><td><span className="admin-code">{store.code}</span></td><td>{store.name}</td><td>{store.timezone}</td><td>{store.currency}</td><td><StatusBadge tone={store.status === "ACTIVE" ? "success" : "warning"}>{store.status}</StatusBadge></td></tr>)}{organization.stores.length === 0 ? <tr><td colSpan={5} className="admin-muted">ยังไม่มี store</td></tr> : null}</tbody></table></div></Card>
        <Card className="admin-panel"><h2>Members</h2><div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>Identity</th><th>Role</th><th>Status</th><th>Created</th></tr></thead><tbody>{organization.members.map((member) => <tr key={member.membershipId}><td><div className="admin-table-primary"><strong>{member.displayName || member.email}</strong><small>{member.email}</small></div></td><td>{member.role}</td><td><StatusBadge tone={member.status === "ACTIVE" ? "success" : "warning"}>{member.status}</StatusBadge></td><td>{new Date(member.createdAt).toLocaleDateString("en-GB")}</td></tr>)}{organization.members.length === 0 ? <tr><td colSpan={4} className="admin-muted">ยังไม่มี member</td></tr> : null}</tbody></table></div></Card>
      </> : null}
    </>
  );
}
