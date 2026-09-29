import { Activity, BarChart3, CalendarDays, Flag, Map, MessageCircleWarning, Route, Settings2, ShoppingBag, Store } from "lucide-react";
import type { AevoGoFeatureFlag, AevoGoOverview, AevoGoSettings } from "@aevocado/api-contract";
import { Card, OfflineState, StatusBadge } from "@aevocado/design-system";
import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requestOptional, type DataSourceStatus } from "../lib/admin-resilience.server";
import { createAdminApiClient, requireAdminAccess } from "../lib/auth.server";
import { hasAdminPermission, type AdminLoaderData } from "../lib/auth.shared";

interface GoSettingsResource {
  success: true;
  settings: AevoGoSettings;
  settingsUpdatedAt: string;
  settingsUpdatedBy: string | null;
  featureFlags: Record<string, Omit<AevoGoFeatureFlag, "flagKey">>;
}

interface GoDashboardLoaderData {
  session: AdminLoaderData;
  days: 7 | 30 | 90;
  overview: AevoGoOverview | null;
  settings: AevoGoSettings | null;
  featureFlags: AevoGoFeatureFlag[];
  overviewStatus: DataSourceStatus;
  settingsStatus: DataSourceStatus;
  message?: string;
}

function featureFlagsFromResource(resource: GoSettingsResource | null): AevoGoFeatureFlag[] {
  if (!resource) return [];
  return Object.entries(resource.featureFlags).map(([flagKey, flag]) => ({ flagKey, ...flag }));
}

export async function loader({ request }: LoaderFunctionArgs): Promise<GoDashboardLoaderData> {
  const session = await requireAdminAccess(request);
  const requestedDays = Number.parseInt(new URL(request.url).searchParams.get("days") ?? "30", 10);
  const days: 7 | 30 | 90 = requestedDays === 7 || requestedDays === 90 ? requestedDays : 30;
  if (session.connection !== "connected") {
    return {
      session,
      days,
      overview: null,
      settings: null,
      featureFlags: [],
      overviewStatus: session.connection,
      settingsStatus: session.connection,
      message: session.connectionMessage
    };
  }

  const api = createAdminApiClient(request);
  const overviewResource = hasAdminPermission(session, "go.analytics.read")
    ? requestOptional<{ success: true; overview: AevoGoOverview }>(api, `/api/v1/admin/go/overview?days=${days}`)
    : Promise.resolve({ data: null, status: "denied" as const, message: "บัญชีนี้ไม่มีสิทธิ์อ่าน Aevo Go analytics" });
  const settingsResource = hasAdminPermission(session, "go.settings.read")
    ? requestOptional<GoSettingsResource>(api, "/api/v1/admin/go/settings")
    : Promise.resolve({ data: null, status: "denied" as const, message: "บัญชีนี้ไม่มีสิทธิ์อ่าน Aevo Go settings" });

  const [overview, settings] = await Promise.all([overviewResource, settingsResource]);
  return {
    session,
    days,
    overview: overview.data?.overview ?? null,
    settings: settings.data?.settings ?? null,
    featureFlags: featureFlagsFromResource(settings.data),
    overviewStatus: overview.status,
    settingsStatus: settings.status,
    message: overview.message ?? settings.message
  };
}

function number(value: number | null): string {
  return value === null ? "—" : new Intl.NumberFormat("en-US").format(value);
}

function percentage(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}%`;
}

function dateLabel(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short" }).format(date);
}

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/(^|\s)\S/gu, (character) => character.toUpperCase());
}

function statusTone(enabled: boolean | null): "success" | "neutral" {
  return enabled === true ? "success" : "neutral";
}

export default function GoDashboardRoute() {
  const data = useLoaderData() as GoDashboardLoaderData;
  const overview = data.overview;
  const activeDays = overview?.windowDays ?? data.days;
  const completionRate = overview && overview.totalJourneys > 0
    ? (overview.completedJourneys / overview.totalJourneys) * 100
    : overview ? 0 : null;
  const interactionRate = overview && overview.feedImpressions > 0
    ? (overview.feedInteractions / overview.feedImpressions) * 100
    : overview ? 0 : null;
  const maxActivity = overview
    ? Math.max(...overview.dailyActivity.map((day) => day.events + day.impressions + day.interactions), 1)
    : 1;
  const analyticsDenied = data.overviewStatus === "denied";

  return (
    <>
      <section className="admin-page-heading admin-go-heading">
        <div>
          <span className="admin-eyebrow">Aevo Go / product control plane</span>
          <h1>Go dashboard</h1>
          <p>ดูพฤติกรรมการค้นพบ, TraceDee loop, moderation และ event pipeline ของ Aevo Go จากข้อมูลที่ Core API เก็บจริง โดยไม่ปนกับ platform operations</p>
        </div>
        <div className="admin-page-heading__actions admin-go-heading__actions">
          <nav className="admin-go-range" aria-label="ช่วงเวลาของ dashboard">
            {[7, 30, 90].map((days) => (
              <Link className={activeDays === days ? "admin-go-range__item is-active" : "admin-go-range__item"} to={`/go?days=${days}`} aria-current={activeDays === days ? "page" : undefined} key={days}>{days}d</Link>
            ))}
          </nav>
          <Link className="aevo-button aevo-button--secondary" to="/go/feed"><Activity size={15} aria-hidden="true" />Feed control</Link>
          <Link className="aevo-button aevo-button--secondary" to="/go/settings"><Settings2 size={15} aria-hidden="true" />ตั้งค่า Go</Link>
          <Link className="aevo-button aevo-button--ghost" to="/audit-logs?app=GO">ดู Go audit</Link>
        </div>
      </section>

      {analyticsDenied ? (
        <Card className="admin-panel"><h2>ไม่มีสิทธิ์อ่าน Aevo Go analytics</h2><p className="admin-muted">ต้องมี `go.analytics.read` เพื่อดูข้อมูลเชิงสถิติของ Go; สิทธิ์นี้แยกจาก organization membership และ platform overview</p></Card>
      ) : null}

      {!analyticsDenied && data.overviewStatus !== "connected" ? (
        <OfflineState
          title="Aevo Go analytics ยังไม่พร้อมใช้งาน"
          description={data.message ?? "Core API ยังไม่ส่ง Go overview กลับมา ตัวเลขจะแสดงเมื่อ endpoint และฐานข้อมูลพร้อม"}
          action={<Link className="aevo-button aevo-button--secondary" to="/connections">ตรวจ Connections</Link>}
        />
      ) : null}

      <section className="admin-kpi-grid admin-go-kpi-grid" aria-label="Aevo Go product overview">
        <Card className="admin-kpi"><span>TraceDee places</span><strong>{number(overview?.activePlaces ?? null)}</strong><small>Moderated places visible in Go</small></Card>
        <Card className="admin-kpi"><span>Published traces</span><strong>{number(overview?.publishedTraces ?? null)}</strong><small>TraceDee public content</small></Card>
        <Card className="admin-kpi"><span>Journeys completed</span><strong>{percentage(completionRate)}</strong><small>{number(overview?.completedJourneys ?? null)} / {number(overview?.totalJourneys ?? null)} journeys</small></Card>
        <Card className="admin-kpi"><span>Average rating</span><strong>{overview ? overview.averageRating.toFixed(2) : "—"}</strong><small>{number(overview?.ratingsCount ?? null)} visible ratings</small></Card>
        <Card className="admin-kpi"><span>Feed interaction</span><strong>{percentage(interactionRate)}</strong><small>{number(overview?.feedInteractions ?? null)} / {number(overview?.feedImpressions ?? null)} in {activeDays} days</small></Card>
      </section>

      <section className="admin-go-commerce-grid" aria-label="Aevo Go customer and commerce metrics">
        <Card className="admin-go-commerce-card">
          <div className="admin-go-commerce-card__top"><span className="admin-eyebrow">Customer surface</span><Store size={18} aria-hidden="true" /></div>
          <strong>{number(overview?.publicStores ?? null)}</strong>
          <span>Public stores</span>
          <small>Public profiles currently discoverable in Aevo Go</small>
        </Card>
        <Card className="admin-go-commerce-card">
          <div className="admin-go-commerce-card__top"><span className="admin-eyebrow">Booking loop</span><CalendarDays size={18} aria-hidden="true" /></div>
          <strong>{number(overview?.bookingsCreated ?? null)}</strong>
          <span>Bookings created</span>
          <small>{number(overview?.bookingsCompleted ?? null)} completed · {number(overview?.bookingsCancelled ?? null)} cancelled</small>
        </Card>
        <Card className="admin-go-commerce-card">
          <div className="admin-go-commerce-card__top"><span className="admin-eyebrow">Order loop</span><ShoppingBag size={18} aria-hidden="true" /></div>
          <strong>{number(overview?.ordersCreated ?? null)}</strong>
          <span>Orders created</span>
          <small>{number(overview?.ordersCompleted ?? null)} completed in the selected window</small>
        </Card>
      </section>

      <section className="admin-go-grid">
        <Card className="admin-panel admin-go-chart-card">
          <div className="admin-panel__heading">
            <div><span className="admin-eyebrow">Event pulse</span><h2>Go activity · {activeDays} days</h2></div>
            <BarChart3 size={20} aria-hidden="true" />
          </div>
          {overview?.dailyActivity.length ? (
            <div className="admin-go-chart" role="img" aria-label={`Aevo Go activity for the last ${activeDays} days`}>
              {overview.dailyActivity.map((day) => {
                const total = day.events + day.impressions + day.interactions;
                return (
                  <div className="admin-go-chart__day" key={day.date} title={`${dateLabel(day.date)} · ${total} events`}>
                    <span className="admin-go-chart__bar" style={{ height: `${Math.max((total / maxActivity) * 100, total > 0 ? 8 : 2)}%` }} />
                    <small>{dateLabel(day.date)}</small>
                  </div>
                );
              })}
            </div>
          ) : <p className="admin-muted">ยังไม่มี activity events ในช่วงเวลานี้</p>}
          <div className="admin-go-chart__legend" aria-label="Activity legend">
            <span><Activity size={13} aria-hidden="true" />Events {number(overview?.activityEvents ?? null)}</span>
            <span><Map size={13} aria-hidden="true" />Impressions {number(overview?.feedImpressions ?? null)}</span>
            <span><Route size={13} aria-hidden="true" />Interactions {number(overview?.feedInteractions ?? null)}</span>
          </div>
        </Card>

        <Card className="admin-panel">
          <div className="admin-panel__heading"><div><span className="admin-eyebrow">Operational signals</span><h2>สิ่งที่ควรดูต่อ</h2></div><Activity size={20} aria-hidden="true" /></div>
          <div className="admin-go-signal-list">
            <div><span><MessageCircleWarning size={15} aria-hidden="true" />Open reports</span><strong>{number(overview?.openReports ?? null)}</strong></div>
            <div><span><Activity size={15} aria-hidden="true" />Pending event outbox</span><strong>{number(overview?.pendingOutbox ?? null)}</strong></div>
            <div><span><Flag size={15} aria-hidden="true" />Enabled feature flags</span><strong>{overview ? `${overview.enabledFeatureFlags}/${overview.featureFlagCount}` : "—"}</strong></div>
          </div>
          <p className="admin-muted admin-go-signal-note">ค่าพวกนี้ช่วยแยก product health ออกจาก Core API health และใช้เป็นจุดเริ่มต้นสำหรับ moderation หรือ replay pipeline</p>
        </Card>
      </section>

      <section className="admin-go-grid">
        <Card className="admin-panel">
          <div className="admin-panel__heading"><div><span className="admin-eyebrow">Feature posture</span><h2>TraceDee feature flags</h2></div><Link className="admin-text-link" to="/go/settings">จัดการ flags</Link></div>
          {data.featureFlags.length ? (
            <div className="admin-go-flag-list">
              {data.featureFlags.map((flag) => (
                <div className="admin-go-flag-row" key={flag.flagKey}>
                  <span><strong>{label(flag.flagKey)}</strong><small>{flag.flagKey}</small></span>
                  <StatusBadge tone={flag.enabled && flag.rolloutPercent > 0 ? "success" : "neutral"}>{flag.enabled ? `${flag.rolloutPercent}% rollout` : "Off"}</StatusBadge>
                </div>
              ))}
            </div>
          ) : <p className="admin-muted">ยังไม่มีข้อมูล feature flags หรือยังไม่มีสิทธิ์อ่าน settings</p>}
        </Card>

        <Card className="admin-panel">
          <div className="admin-panel__heading"><div><span className="admin-eyebrow">Configuration posture</span><h2>Go settings</h2></div><Link className="admin-text-link" to="/go/settings">เปิด settings</Link></div>
          {data.settings ? (
            <div className="admin-go-setting-list">
              <div><span>Search</span><StatusBadge tone={statusTone(data.settings.discovery.searchEnabled)}>{data.settings.discovery.searchEnabled ? "Enabled" : "Disabled"}</StatusBadge></div>
              <div><span>Map discovery</span><StatusBadge tone={statusTone(data.settings.discovery.mapEnabled)}>{data.settings.discovery.mapEnabled ? "Enabled" : "Disabled"}</StatusBadge></div>
              <div><span>TraceDee community</span><StatusBadge tone={statusTone(data.settings.community.traceDeeEnabled)}>{data.settings.community.traceDeeEnabled ? "Enabled" : "Disabled"}</StatusBadge></div>
              <div><span>Analytics retention</span><span className="admin-code">{data.settings.analytics.retentionDays} days</span></div>
            </div>
          ) : <p className="admin-muted">Settings ยังไม่เชื่อมต่อหรือ role นี้ไม่มีสิทธิ์อ่าน</p>}
        </Card>
      </section>

      <p className="admin-muted admin-source-note"><Activity size={14} aria-hidden="true" /> Source: Core API `/api/v1/admin/go/overview` · ไม่มี sample metric</p>
    </>
  );
}
