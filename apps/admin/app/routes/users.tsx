import { Users } from "lucide-react";
import { Card, OfflineState, StatusBadge } from "@aevocado/design-system";
import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { AdminListStandard, type AdminListColumn } from "../components/admin-list-standard";
import { requestOptional, type DataSourceStatus } from "../lib/admin-resilience.server";
import { parseAdminListQuery, type AdminListDirection } from "../lib/admin-list-query";
import { createAdminApiClient, requireAdminAccess } from "../lib/auth.server";
import { hasAdminPermission, type AdminLoaderData } from "../lib/auth.shared";

interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  status: string;
  memberships: Array<{ organizationName: string; role: string }>;
}

interface UsersLoaderData {
  session: AdminLoaderData;
  users: AdminUser[];
  query: string;
  statusFilter: string;
  page: number;
  limit: number;
  sort: string;
  direction: AdminListDirection;
  hasMore: boolean;
  denied: boolean;
  status: DataSourceStatus;
  message?: string;
}

export async function loader({ request }: LoaderFunctionArgs): Promise<UsersLoaderData> {
  const session = await requireAdminAccess(request);
  const url = new URL(request.url);
  const listQuery = parseAdminListQuery(url, "email", "asc");
  const statusFilter = url.searchParams.get("status")?.trim() ?? "";
  if (session.connection !== "connected") return { session, users: [], query: listQuery.query, statusFilter, page: listQuery.page, limit: listQuery.limit, sort: listQuery.sort, direction: listQuery.direction, hasMore: false, denied: false, status: session.connection, message: session.connectionMessage };
  if (!hasAdminPermission(session, "organization.read")) return { session, users: [], query: listQuery.query, statusFilter, page: listQuery.page, limit: listQuery.limit, sort: listQuery.sort, direction: listQuery.direction, hasMore: false, denied: true, status: "denied" };
  const params = new URLSearchParams({ limit: String(listQuery.limit), page: String(listQuery.page), sort: listQuery.sort, direction: listQuery.direction });
  if (listQuery.query) params.set("q", listQuery.query);
  if (statusFilter) params.set("status", statusFilter);
  const result = await requestOptional<{ success: true; users: AdminUser[]; page: number; hasMore: boolean }>(createAdminApiClient(request), `/api/v1/admin/users?${params.toString()}`);
  return { session, users: result.data?.users ?? [], query: listQuery.query, statusFilter, page: result.data?.page ?? listQuery.page, limit: listQuery.limit, sort: listQuery.sort, direction: listQuery.direction, hasMore: result.data?.hasMore ?? false, denied: result.status === "denied", status: result.status, message: result.message };
}

export default function UsersRoute() {
  const data = useLoaderData() as UsersLoaderData;
  if (data.denied) return <Card className="admin-panel"><h1>Users & access</h1><p className="admin-muted">บัญชีนี้ไม่มีสิทธิ์อ่าน user directory</p></Card>;

  const columns: AdminListColumn<AdminUser>[] = [
    { key: "user", label: "User", sortable: true, render: (user) => <div className="admin-table-primary"><span className="admin-application-icon"><Users size={15} aria-hidden="true" /></span><span><strong>{user.displayName || user.email}</strong><small>{user.email}</small></span></div>, exportValue: (user) => `${user.displayName || user.email} · ${user.email}` },
    { key: "status", label: "Status", sortable: true, render: (user) => <StatusBadge tone={user.status === "ACTIVE" ? "success" : "danger"}>{user.status}</StatusBadge>, exportValue: (user) => user.status },
    { key: "organizations", label: "Organizations", sortable: true, render: (user) => user.memberships.length || "—", exportValue: (user) => String(user.memberships.length) },
    { key: "roles", label: "Roles", render: (user) => <div className="admin-tag-list">{user.memberships.length ? user.memberships.map((membership) => <span className="admin-tag" key={`${user.id}-${membership.organizationName}-${membership.role}`}>{membership.organizationName} · {membership.role}</span>) : <span className="admin-muted">No memberships</span>}</div>, exportValue: (user) => user.memberships.map((membership) => `${membership.organizationName} · ${membership.role}`).join("; ") },
    { key: "details", label: "รายละเอียด", render: (user) => <Link className="admin-text-link" to={`/users/${user.id}`}>ดู / จัดการ</Link>, exportValue: () => "" }
  ];

  return (
    <>
      <section className="admin-page-heading"><div><span className="admin-eyebrow">Identity directory</span><h1>Users & access</h1><p>ตรวจ identity และ organization membership โดยไม่ยกระดับ owner ให้เป็น platform administrator</p></div><StatusBadge tone="info">{data.users.length} users</StatusBadge></section>
      {data.status !== "connected" ? <OfflineState title="User directory ยังไม่เชื่อมต่อ" description={data.message ?? "ข้อมูล identity จะแสดงเมื่อ Core API พร้อม"} /> : null}
      <AdminListStandard listKey="users" caption="User directory" rows={data.users} columns={columns} getRowId={(user) => user.id} emptyMessage="ไม่พบ user ตามตัวกรอง" query={data.query} placeholder="ชื่อหรือ email" filters={[{ name: "status", label: "สถานะ", value: data.statusFilter, options: [{ value: "", label: "ทุกสถานะ" }, { value: "ACTIVE", label: "ACTIVE" }, { value: "DISABLED", label: "DISABLED" }] }]} page={data.page} limit={data.limit} hasMore={data.hasMore} sort={data.sort} direction={data.direction} />
    </>
  );
}
