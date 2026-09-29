import { CreditCard } from "lucide-react";
import { Card, OfflineState, StatusBadge } from "@aevocado/design-system";
import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { AdminListStandard, type AdminListColumn } from "../components/admin-list-standard";
import { requestOptional, type DataSourceStatus } from "../lib/admin-resilience.server";
import { parseAdminListQuery, type AdminListDirection } from "../lib/admin-list-query";
import { createAdminApiClient, requireAdminAccess } from "../lib/auth.server";
import { hasAdminPermission, type AdminLoaderData } from "../lib/auth.shared";

interface AdminSubscription {
  id: string;
  organizationId: string;
  organizationName: string;
  planId: string;
  provider: string;
  status: string;
  currentPeriodEnd?: string | null;
}

interface SubscriptionsLoaderData {
  session: AdminLoaderData;
  subscriptions: AdminSubscription[];
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

export async function loader({ request }: LoaderFunctionArgs): Promise<SubscriptionsLoaderData> {
  const session = await requireAdminAccess(request);
  const url = new URL(request.url);
  const listQuery = parseAdminListQuery(url, "updatedAt", "desc");
  const statusFilter = url.searchParams.get("status")?.trim() ?? "";
  if (session.connection !== "connected") return { session, subscriptions: [], query: listQuery.query, statusFilter, page: listQuery.page, limit: listQuery.limit, sort: listQuery.sort, direction: listQuery.direction, hasMore: false, denied: false, status: session.connection, message: session.connectionMessage };
  if (!hasAdminPermission(session, "subscription.read")) return { session, subscriptions: [], query: listQuery.query, statusFilter, page: listQuery.page, limit: listQuery.limit, sort: listQuery.sort, direction: listQuery.direction, hasMore: false, denied: true, status: "denied" };
  const params = new URLSearchParams({ limit: String(listQuery.limit), page: String(listQuery.page), sort: listQuery.sort, direction: listQuery.direction });
  if (listQuery.query) params.set("q", listQuery.query);
  if (statusFilter) params.set("status", statusFilter);
  const result = await requestOptional<{ success: true; subscriptions: AdminSubscription[]; page: number; hasMore: boolean }>(createAdminApiClient(request), `/api/v1/admin/subscriptions?${params.toString()}`);
  return { session, subscriptions: result.data?.subscriptions ?? [], query: listQuery.query, statusFilter, page: result.data?.page ?? listQuery.page, limit: listQuery.limit, sort: listQuery.sort, direction: listQuery.direction, hasMore: result.data?.hasMore ?? false, denied: result.status === "denied", status: result.status, message: result.message };
}

export default function SubscriptionsRoute() {
  const data = useLoaderData() as SubscriptionsLoaderData;
  if (data.denied) return <Card className="admin-panel"><h1>Subscriptions</h1><p className="admin-muted">บัญชีนี้ไม่มีสิทธิ์อ่าน billing records</p></Card>;
  const columns: AdminListColumn<AdminSubscription>[] = [
    { key: "organization", label: "Organization", sortable: true, render: (subscription) => <div className="admin-table-primary"><span className="admin-application-icon"><CreditCard size={15} aria-hidden="true" /></span><span><strong>{subscription.organizationName}</strong><small>{subscription.organizationId}</small></span></div>, exportValue: (subscription) => `${subscription.organizationName} · ${subscription.organizationId}` },
    { key: "plan", label: "Plan", sortable: true, render: (subscription) => <span className="admin-code">{subscription.planId}</span>, exportValue: (subscription) => subscription.planId },
    { key: "provider", label: "Provider", sortable: true, render: (subscription) => subscription.provider, exportValue: (subscription) => subscription.provider },
    { key: "status", label: "Status", sortable: true, render: (subscription) => <StatusBadge tone={subscription.status === "ACTIVE" ? "success" : "warning"}>{subscription.status}</StatusBadge>, exportValue: (subscription) => subscription.status },
    { key: "periodEnd", label: "Period end", sortable: true, render: (subscription) => subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString("en-GB") : "—", exportValue: (subscription) => subscription.currentPeriodEnd ?? "" },
    { key: "details", label: "รายละเอียด", render: (subscription) => <Link className="admin-text-link" to={`/subscriptions/${subscription.id}`}>ดูรายละเอียด</Link>, exportValue: () => "" }
  ];
  return (
    <>
      <section className="admin-page-heading"><div><span className="admin-eyebrow">Billing source of truth</span><h1>Subscriptions</h1><p>ตรวจ plan และ lifecycle จากข้อมูลที่ถูก sync โดย webhook ไม่ใช่ค่าที่ client รายงาน</p></div><StatusBadge tone="info">{data.subscriptions.length} records</StatusBadge></section>
      {data.status !== "connected" ? <OfflineState title="Subscription directory ยังไม่เชื่อมต่อ" description={data.message ?? "ข้อมูล billing จะแสดงเมื่อ Core API พร้อม"} /> : null}
      <AdminListStandard listKey="subscriptions" caption="Subscription directory" rows={data.subscriptions} columns={columns} getRowId={(subscription) => subscription.id} emptyMessage="ไม่พบ billing record ตามตัวกรอง" query={data.query} placeholder="องค์กร, plan หรือ provider id" filters={[{ name: "status", label: "สถานะ", value: data.statusFilter, options: [{ value: "", label: "ทุกสถานะ" }, { value: "TRIALING", label: "TRIALING" }, { value: "ACTIVE", label: "ACTIVE" }, { value: "PAST_DUE", label: "PAST_DUE" }, { value: "GRACE_PERIOD", label: "GRACE_PERIOD" }, { value: "CANCELED", label: "CANCELED" }, { value: "EXPIRED", label: "EXPIRED" }] }]} page={data.page} limit={data.limit} hasMore={data.hasMore} sort={data.sort} direction={data.direction} />
    </>
  );
}
