import { Building2 } from "lucide-react";
import { Card, OfflineState, StatusBadge } from "@aevocado/design-system";
import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { AdminListStandard, type AdminListColumn } from "../components/admin-list-standard";
import { requestOptional, type DataSourceStatus } from "../lib/admin-resilience.server";
import { parseAdminListQuery, type AdminListDirection } from "../lib/admin-list-query";
import { createAdminApiClient, requireAdminAccess } from "../lib/auth.server";
import { hasAdminPermission, type AdminLoaderData } from "../lib/auth.shared";

interface AdminOrganization {
  id: string;
  name: string;
  slug: string;
  status: string;
  maxUsers: number | null;
  maxStores: number | null;
  storesCount: number;
  membersCount: number;
  createdAt: string;
}

interface OrganizationsLoaderData {
  session: AdminLoaderData;
  organizations: AdminOrganization[];
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

export async function loader({ request }: LoaderFunctionArgs): Promise<OrganizationsLoaderData> {
  const session = await requireAdminAccess(request);
  const url = new URL(request.url);
  const listQuery = parseAdminListQuery(url, "createdAt", "desc");
  const statusFilter = url.searchParams.get("status")?.trim() ?? "";
  if (session.connection !== "connected") return { session, organizations: [], query: listQuery.query, statusFilter, page: listQuery.page, limit: listQuery.limit, sort: listQuery.sort, direction: listQuery.direction, hasMore: false, denied: false, status: session.connection, message: session.connectionMessage };
  if (!hasAdminPermission(session, "organization.read")) return { session, organizations: [], query: listQuery.query, statusFilter, page: listQuery.page, limit: listQuery.limit, sort: listQuery.sort, direction: listQuery.direction, hasMore: false, denied: true, status: "denied" };
  const params = new URLSearchParams({ limit: String(listQuery.limit), page: String(listQuery.page), sort: listQuery.sort, direction: listQuery.direction });
  if (listQuery.query) params.set("q", listQuery.query);
  if (statusFilter) params.set("status", statusFilter);
  const result = await requestOptional<{ success: true; organizations: AdminOrganization[]; page: number; hasMore: boolean }>(createAdminApiClient(request), `/api/v1/admin/organizations?${params.toString()}`);
  return { session, organizations: result.data?.organizations ?? [], query: listQuery.query, statusFilter, page: result.data?.page ?? listQuery.page, limit: listQuery.limit, sort: listQuery.sort, direction: listQuery.direction, hasMore: result.data?.hasMore ?? false, denied: result.status === "denied", status: result.status, message: result.message };
}

export default function OrganizationsRoute() {
  const data = useLoaderData() as OrganizationsLoaderData;
  if (data.denied) return <Card className="admin-panel"><h1>Organizations</h1><p className="admin-muted">บัญชีนี้ไม่มีสิทธิ์อ่านข้อมูลข้ามองค์กร</p></Card>;
  const quota = (value: number | null): string => value === null ? "—" : String(value);
  const columns: AdminListColumn<AdminOrganization>[] = [
    { key: "organization", label: "Organization", sortable: true, render: (organization) => <div className="admin-table-primary"><span className="admin-application-icon"><Building2 size={15} aria-hidden="true" /></span><span><strong>{organization.name}</strong><small>{organization.slug}</small></span></div>, exportValue: (organization) => `${organization.name} · ${organization.slug}` },
    { key: "status", label: "Status", sortable: true, render: (organization) => <StatusBadge tone={organization.status === "ACTIVE" ? "success" : "warning"}>{organization.status}</StatusBadge>, exportValue: (organization) => organization.status },
    { key: "stores", label: "Stores", sortable: true, render: (organization) => `${organization.storesCount} / ${quota(organization.maxStores)}`, exportValue: (organization) => `${organization.storesCount} / ${quota(organization.maxStores)}` },
    { key: "members", label: "Members", sortable: true, render: (organization) => `${organization.membersCount} / ${quota(organization.maxUsers)}`, exportValue: (organization) => `${organization.membersCount} / ${quota(organization.maxUsers)}` },
    { key: "quotas", label: "Quotas", render: (organization) => <span className="admin-code">{quota(organization.maxUsers)} users · {quota(organization.maxStores)} stores</span>, exportValue: (organization) => `${quota(organization.maxUsers)} users · ${quota(organization.maxStores)} stores` },
    { key: "created", label: "Created", sortable: true, render: (organization) => new Date(organization.createdAt).toLocaleDateString("en-GB"), exportValue: (organization) => organization.createdAt },
    { key: "details", label: "รายละเอียด", render: (organization) => <Link className="admin-text-link" to={`/organizations/${organization.id}`}>ดู / แก้ไข</Link>, exportValue: () => "" }
  ];
  return (
    <>
      <section className="admin-page-heading"><div><span className="admin-eyebrow">Cross-tenant directory</span><h1>Organizations</h1><p>ข้อมูลนี้เป็น platform-level view สำหรับ support, operations และ governance เท่านั้น</p></div><div className="admin-page-heading__actions"><StatusBadge tone="info">{data.organizations.length} tenants</StatusBadge></div></section>
      {data.status !== "connected" ? <OfflineState title="Organization directory ยังไม่เชื่อมต่อ" description={data.message ?? "ข้อมูล tenant จะแสดงเมื่อ Core API พร้อม"} /> : null}
      <AdminListStandard listKey="organizations" caption="Organization directory" rows={data.organizations} columns={columns} getRowId={(organization) => organization.id} emptyMessage="ไม่พบองค์กรตามตัวกรอง" query={data.query} placeholder="ชื่อหรือ slug" filters={[{ name: "status", label: "สถานะ", value: data.statusFilter, options: [{ value: "", label: "ทุกสถานะ" }, { value: "ACTIVE", label: "ACTIVE" }, { value: "SUSPENDED", label: "SUSPENDED" }] }]} page={data.page} limit={data.limit} hasMore={data.hasMore} sort={data.sort} direction={data.direction} createHref={hasAdminPermission(data.session, "organization.manage") ? "/organizations/new" : undefined} createLabel="สร้างองค์กร" />
    </>
  );
}
