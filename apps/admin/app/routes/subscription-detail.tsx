import { Card, StatusBadge } from "@aevocado/design-system";
import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requestOptional, type DataSourceStatus } from "../lib/admin-resilience.server";
import { createAdminApiClient, requireAdminAccess } from "../lib/auth.server";
import { type AdminLoaderData } from "../lib/auth.shared";

interface SubscriptionDetail {
  id: string;
  organizationId: string;
  organizationName: string;
  planId: string;
  provider: string;
  status: string;
  trialEnd: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  providerSubscriptionId: string | null;
  projectionVersion: string;
  updatedAt: string;
}

interface SubscriptionLoaderData {
  session: AdminLoaderData;
  subscription: SubscriptionDetail | null;
  status: DataSourceStatus;
  denied: boolean;
  message?: string;
}

export async function loader({ request, params }: LoaderFunctionArgs): Promise<SubscriptionLoaderData> {
  const session = await requireAdminAccess(request);
  const subscriptionId = params.subscriptionId ?? "";
  if (session.connection !== "connected") return { session, subscription: null, status: session.connection, denied: false, message: session.connectionMessage };
  const resource = await requestOptional<{ success: true; subscription: SubscriptionDetail }>(createAdminApiClient(request), `/api/v1/admin/subscriptions/${encodeURIComponent(subscriptionId)}`);
  return { session, subscription: resource.data?.subscription ?? null, status: resource.status, denied: resource.status === "denied", message: resource.message };
}

function dateLabel(value: string | null): string {
  return value ? new Date(value).toLocaleString("en-GB") : "—";
}

export default function SubscriptionDetailRoute() {
  const data = useLoaderData() as SubscriptionLoaderData;
  if (data.denied) return <Card className="admin-panel"><h1>Subscription detail</h1><p className="admin-muted">บัญชีนี้ไม่มีสิทธิ์อ่าน billing records</p></Card>;
  if (data.status !== "connected") return <Card className="admin-panel"><h1>Subscription detail</h1><p className="admin-muted">{data.message ?? "Core API ยังไม่พร้อมใช้งาน"}</p><Link className="aevo-button aevo-button--ghost" to="/subscriptions">กลับ directory</Link></Card>;
  if (!data.subscription) return <Card className="admin-panel"><h1>ไม่พบ Subscription</h1><Link className="aevo-button aevo-button--ghost" to="/subscriptions">กลับ directory</Link></Card>;
  const subscription = data.subscription;
  return (
    <>
      <section className="admin-page-heading"><div><span className="admin-eyebrow">Billing projection</span><h1>{subscription.organizationName}</h1><p>รายละเอียดจาก Core billing projection; เปลี่ยน plan/cancel ต้องมาจาก provider webhook หรือ workflow ที่ได้รับอนุมัติ</p></div><Link className="aevo-button aevo-button--ghost" to="/subscriptions">กลับ directory</Link></section>
      <Card className="admin-panel"><div className="admin-detail-grid"><div><span className="admin-eyebrow">Plan</span><p className="admin-code">{subscription.planId}</p></div><div><span className="admin-eyebrow">Provider</span><p>{subscription.provider}</p></div><div><span className="admin-eyebrow">Status</span><StatusBadge tone={subscription.status === "ACTIVE" ? "success" : "warning"}>{subscription.status}</StatusBadge></div><div><span className="admin-eyebrow">Cancel at period end</span><p>{subscription.cancelAtPeriodEnd ? "Yes" : "No"}</p></div><div><span className="admin-eyebrow">Trial end</span><p>{dateLabel(subscription.trialEnd)}</p></div><div><span className="admin-eyebrow">Current period</span><p>{dateLabel(subscription.currentPeriodStart)} → {dateLabel(subscription.currentPeriodEnd)}</p></div><div><span className="admin-eyebrow">Provider subscription id</span><p className="admin-code">{subscription.providerSubscriptionId ?? "—"}</p></div><div><span className="admin-eyebrow">Projection</span><p className="admin-code">{subscription.projectionVersion}</p></div><div><span className="admin-eyebrow">Updated</span><p>{dateLabel(subscription.updatedAt)}</p></div></div></Card>
      <Card className="admin-panel"><h2>Governance boundary</h2><p className="admin-muted">รายการนี้เป็น projection ที่รับจาก billing source of truth จึงไม่มีปุ่มสร้าง/ลบโดยตรงใน Admin การเปลี่ยนแปลงต้องผ่าน provider webhook หรือ billing workflow ที่บันทึก audit</p><Link className="admin-text-link" to={`/organizations/${subscription.organizationId}`}>ดู Organization ที่เกี่ยวข้อง</Link></Card>
    </>
  );
}
