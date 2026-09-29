import { Activity, Boxes, Building2, Cable, CreditCard, ScrollText, Users } from "lucide-react";
import { Card, OfflineState, StatusBadge } from "@aevocado/design-system";
import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requestOptional, type DataSourceStatus } from "../lib/admin-resilience.server";
import { disconnectedApplications, normalizeApplications, type AdminApplication } from "../lib/application-registry";
import { createAdminApiClient, requireAdminAccess } from "../lib/auth.server";
import { hasAdminPermission, type AdminLoaderData } from "../lib/auth.shared";

interface PlatformOverview {
  totalOrganizations: number;
  totalStores: number;
  totalUsers: number;
  totalDevices: number;
  totalSubscriptions: number;
  operatingMode: { mode: string; unlimited: boolean };
}

interface DashboardLoaderData {
  session: AdminLoaderData;
  overview: PlatformOverview | null;
  applications: AdminApplication[];
  overviewStatus: DataSourceStatus;
  applicationsStatus: DataSourceStatus;
  overviewMessage?: string;
}

export async function loader({ request }: LoaderFunctionArgs): Promise<DashboardLoaderData> {
  const session = await requireAdminAccess(request);
  if (session.connection !== "connected") {
    return {
      session,
      overview: null,
      applications: disconnectedApplications(),
      overviewStatus: session.connection,
      applicationsStatus: session.connection,
      overviewMessage: session.connectionMessage
    };
  }

  if (!hasAdminPermission(session, "system.health")) {
    return {
      session,
      overview: null,
      applications: [],
      overviewStatus: "denied",
      applicationsStatus: "denied",
      overviewMessage: "บัญชีนี้ไม่มี permission สำหรับ platform overview และ application registry"
    };
  }

  const api = createAdminApiClient(request);
  const [overviewResource, applicationsResource] = await Promise.all([
    requestOptional<{ success: true } & PlatformOverview>(api, "/api/v1/admin/overview"),
    requestOptional<{ success: true; applications: Array<{ code: AdminApplication["code"]; name: string; kind: string; status: string; createdAt?: string; updatedAt?: string }> }>(api, "/api/v1/admin/applications")
  ]);

  return {
    session,
    overview: overviewResource.data,
    applications: applicationsResource.data ? normalizeApplications(applicationsResource.data.applications) : disconnectedApplications(),
    overviewStatus: overviewResource.status,
    applicationsStatus: applicationsResource.status,
    overviewMessage: overviewResource.message ?? applicationsResource.message
  };
}

const quickLinks = [
  { to: "/applications", title: "Applications", description: "ตรวจสถานะและควบคุม application registry", icon: Boxes },
  { to: "/connections", title: "Connections", description: "ดูสถานะการเชื่อมต่อของ Core API และ app registry", icon: Cable },
  { to: "/audit-logs", title: "Audit logs", description: "ตรวจเหตุการณ์สำคัญและกรองตาม application boundary", icon: ScrollText },
  { to: "/organizations", title: "Organizations", description: "ดู tenant, stores, quota และสถานะการใช้งาน", icon: Building2 },
  { to: "/subscriptions", title: "Subscriptions", description: "ตรวจ plan, billing provider และ entitlement source", icon: CreditCard },
  { to: "/users", title: "Users & access", description: "ตรวจบัญชี, membership และการเข้าถึงของผู้ใช้", icon: Users }
] as const;

function number(value: number | null): string {
  return value === null ? "—" : new Intl.NumberFormat("en-US").format(value);
}

export default function DashboardRoute() {
  const data = useLoaderData() as DashboardLoaderData;
  const { overview } = data;
  const displayName = data.session.me?.user.displayName || data.session.me?.user.email || "operator";
  const connected = data.session.connection === "connected"
    && data.overviewStatus === "connected"
    && data.applicationsStatus === "connected";

  return (
    <>
      <section className="admin-page-heading">
        <div>
          <StatusBadge tone={data.session.connection === "connected" ? "success" : "warning"}>{data.session.connection === "connected" ? "Platform access verified" : "Read-only shell"}</StatusBadge>
          <h1>Good morning, {displayName}</h1>
          <p>Aevo Admin คือ control plane สำหรับดูแล application boundary, organization lifecycle, billing และระบบปฏิบัติการของ Aevo Ecosystem</p>
        </div>
        <span className="admin-page-heading__code">ADMIN / {data.session.access?.platformRole ?? "UNVERIFIED"}</span>
      </section>

      {!connected ? (
        <OfflineState
          title="ข้อมูล platform ยังไม่พร้อมใช้งาน"
          description={data.overviewMessage ?? "Core API ยังไม่ส่ง overview กลับมา ตัวเลขและสถานะด้านล่างจะแสดงเป็น — จนกว่าจะเชื่อมต่อได้"}
          action={<Link className="aevo-button aevo-button--secondary" to="/connections">เปิด Connections</Link>}
        />
      ) : null}

      <section className="admin-kpi-grid" aria-label="Platform overview">
        <Card className="admin-kpi"><span>Organizations</span><strong>{number(overview?.totalOrganizations ?? null)}</strong><small>Tenant boundaries</small></Card>
        <Card className="admin-kpi"><span>Stores</span><strong>{number(overview?.totalStores ?? null)}</strong><small>Operational locations</small></Card>
        <Card className="admin-kpi"><span>Users</span><strong>{number(overview?.totalUsers ?? null)}</strong><small>Platform identities</small></Card>
        <Card className="admin-kpi"><span>Devices</span><strong>{number(overview?.totalDevices ?? null)}</strong><small>Registered terminals</small></Card>
        <Card className="admin-kpi"><span>Subscriptions</span><strong>{number(overview?.totalSubscriptions ?? null)}</strong><small>Billing records</small></Card>
      </section>

      <section className="admin-section-grid">
        <Card className="admin-panel admin-panel--wide">
          <div className="admin-panel__heading">
            <div><span className="admin-eyebrow">Runtime posture</span><h2>System operating mode</h2></div>
            <StatusBadge tone={overview ? overview.operatingMode.mode === "production" ? "success" : "warning" : "warning"}>{overview?.operatingMode.mode ?? "Not available"}</StatusBadge>
          </div>
          <p className="admin-muted">สถานะนี้ถูกอ่านจาก Core API และไม่สามารถเปลี่ยนจาก client โดยตรง การเปลี่ยนค่าระบบสำคัญต้องผ่าน permission และ audit trail</p>
          <div className="admin-inline-metrics"><span><Activity size={15} aria-hidden="true" /> {overview ? overview.operatingMode.unlimited ? "Unlimited mode enabled" : "Quota enforcement enabled" : "รอ Core API"}</span><Link className="aevo-button aevo-button--secondary" to="/system">Open system health</Link></div>
        </Card>
        <Card className="admin-panel">
          <div className="admin-panel__heading"><div><span className="admin-eyebrow">Application boundary</span><h2>Application registry</h2></div><Link className="admin-text-link" to="/connections">Connections</Link></div>
          <div className="admin-application-list">
            {data.applications.length > 0 ? data.applications.map((application) => (
              <div className="admin-application-row" key={application.code}>
                <span className="admin-application-icon"><Boxes size={15} aria-hidden="true" /></span>
                <span><strong>{application.name}</strong><small>{application.code} · {application.kind}</small></span>
                <StatusBadge tone={application.visibility === "VISIBLE" ? application.status === "ACTIVE" ? "success" : "danger" : "warning"}>{application.visibility === "VISIBLE" ? application.status : "NOT CONNECTED"}</StatusBadge>
              </div>
            )) : <p className="admin-muted">ยังไม่มี application registry ที่อ่านได้</p>}
          </div>
        </Card>
      </section>

      <section className="admin-module-grid" aria-label="Control modules">
        {quickLinks.map(({ to, title, description, icon: Icon }) => (
          <Card className="admin-module-card" key={to}>
            <Icon size={20} aria-hidden="true" />
            <h2>{title}</h2>
            <p>{description}</p>
            <Link className="aevo-button aevo-button--secondary" to={to}>เปิด module</Link>
          </Card>
        ))}
      </section>
    </>
  );
}
