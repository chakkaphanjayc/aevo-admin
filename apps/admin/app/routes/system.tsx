import { Activity } from "lucide-react";
import { Card, OfflineState, StatusBadge } from "@aevocado/design-system";
import { useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requestOptional, type DataSourceStatus } from "../lib/admin-resilience.server";
import { createAdminApiClient, requireAdminAccess } from "../lib/auth.server";
import { hasAdminPermission, type AdminLoaderData } from "../lib/auth.shared";

interface SystemLoaderData {
  session: AdminLoaderData;
  overview: { operatingMode: { mode: string; unlimited: boolean }; totalDevices: number } | null;
  denied: boolean;
  status: DataSourceStatus;
  message?: string;
}

export async function loader({ request }: LoaderFunctionArgs): Promise<SystemLoaderData> {
  const session = await requireAdminAccess(request);
  if (session.connection !== "connected") return { session, overview: null, denied: false, status: session.connection, message: session.connectionMessage };
  if (!hasAdminPermission(session, "system.health")) return { session, overview: null, denied: true, status: "denied" };
  const result = await requestOptional<{ operatingMode: { mode: string; unlimited: boolean }; totalDevices: number } & { success: true }>(createAdminApiClient(request), "/api/v1/admin/overview");
  return { session, overview: result.data, denied: result.status === "denied", status: result.status, message: result.message };
}

export default function SystemRoute() {
  const data = useLoaderData() as SystemLoaderData;
  if (data.denied) return <Card className="admin-panel"><h1>System health</h1><p className="admin-muted">บัญชีนี้ไม่มีสิทธิ์อ่าน system health</p></Card>;
  const gatewayStatus = data.status === "connected"
    ? { tone: "success" as const, label: "Gateway reachable" }
    : data.status === "degraded"
      ? { tone: "warning" as const, label: "Gateway degraded" }
      : { tone: "danger" as const, label: "Gateway unavailable" };
  return (
    <>
      <section className="admin-page-heading"><div><span className="admin-eyebrow">Platform operations</span><h1>System health</h1><p>ภาพรวม runtime และ guardrails ของ Core API ที่แอปอื่นทั้งหมดใช้งานร่วมกัน</p></div><StatusBadge tone={gatewayStatus.tone}>{gatewayStatus.label}</StatusBadge></section>
      {data.status !== "connected" || !data.overview ? <OfflineState title="System health ยังไม่พร้อมใช้งาน" description={data.message ?? "Core API ยังไม่ส่ง system overview กลับมา"} /> : null}
      {data.overview ? <section className="admin-section-grid"><Card className="admin-panel"><div className="admin-panel__heading"><div><span className="admin-eyebrow">Operating mode</span><h2>Runtime policy</h2></div><Activity size={20} aria-hidden="true" /></div><div className="admin-system-value"><strong>{data.overview.operatingMode.mode}</strong><span>{data.overview.operatingMode.unlimited ? "Unlimited quota mode" : "Quota enforcement active"}</span></div></Card><Card className="admin-panel"><span className="admin-eyebrow">Registered hardware</span><h2>{data.overview.totalDevices}</h2><p className="admin-muted">อุปกรณ์ที่อยู่ใน platform registry และอยู่ภายใต้ device boundary</p></Card></section> : null}
    </>
  );
}
