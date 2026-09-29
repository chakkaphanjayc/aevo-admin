import { ApiClientError } from "@aevocado/contracts";
import type { AevoGoFeatureFlag, AevoGoSettings } from "@aevocado/api-contract";
import { Card, Input, OfflineState, StatusBadge } from "@aevocado/design-system";
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation, useSearchParams } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requestOptional, type DataSourceStatus } from "../lib/admin-resilience.server";
import { createAdminApiClient, requestCsrfHeaders, requireAdminAccess } from "../lib/auth.server";
import { hasAdminPermission, type AdminLoaderData } from "../lib/auth.shared";

interface GoSettingsResource {
  success: true;
  settings: AevoGoSettings;
  settingsUpdatedAt: string;
  settingsUpdatedBy: string | null;
  featureFlags: Record<string, Omit<AevoGoFeatureFlag, "flagKey">>;
}

interface GoSettingsLoaderData {
  session: AdminLoaderData;
  settings: AevoGoSettings | null;
  featureFlags: AevoGoFeatureFlag[];
  status: DataSourceStatus;
  denied: boolean;
  canWrite: boolean;
  updatedAt: string | null;
  message?: string;
}

interface GoSettingsActionData {
  ok: false;
  message: string;
}

function featureFlagsFromResource(resource: GoSettingsResource | null): AevoGoFeatureFlag[] {
  if (!resource) return [];
  return Object.entries(resource.featureFlags).map(([flagKey, flag]) => ({ flagKey, ...flag }));
}

export async function loader({ request }: LoaderFunctionArgs): Promise<GoSettingsLoaderData> {
  const session = await requireAdminAccess(request);
  const canRead = session.connection === "connected" && hasAdminPermission(session, "go.settings.read");
  const canWrite = session.connection === "connected" && hasAdminPermission(session, "go.settings.manage");
  if (!canRead) {
    return {
      session,
      settings: null,
      featureFlags: [],
      status: session.connection === "connected" ? "denied" : session.connection,
      denied: session.connection === "connected",
      canWrite,
      updatedAt: null,
      message: session.connection === "connected" ? "บัญชีนี้ไม่มีสิทธิ์อ่าน Aevo Go settings" : session.connectionMessage
    };
  }

  const resource = await requestOptional<GoSettingsResource>(createAdminApiClient(request), "/api/v1/admin/go/settings");
  return {
    session,
    settings: resource.data?.settings ?? null,
    featureFlags: featureFlagsFromResource(resource.data),
    status: resource.status,
    denied: resource.status === "denied",
    canWrite,
    updatedAt: resource.data?.settingsUpdatedAt ?? null,
    message: resource.message
  };
}

function formBoolean(form: FormData, name: string): boolean {
  const value = form.get(name);
  return value === "on" || value === "true";
}

function formInteger(form: FormData, name: string, fallback: number): number {
  const value = Number(form.get(name));
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function rangeError(settings: AevoGoSettings): string | null {
  if (settings.discovery.defaultRadiusKm < 1 || settings.discovery.defaultRadiusKm > 100) return "Default radius ต้องอยู่ระหว่าง 1–100 km";
  if (settings.discovery.maxResults < 10 || settings.discovery.maxResults > 200) return "Max results ต้องอยู่ระหว่าง 10–200";
  if (settings.booking.holdMinutes < 1 || settings.booking.holdMinutes > 60) return "Booking hold ต้องอยู่ระหว่าง 1–60 นาที";
  if (settings.booking.maxPartySize < 1 || settings.booking.maxPartySize > 100) return "Max party size ต้องอยู่ระหว่าง 1–100";
  if (settings.analytics.retentionDays < 7 || settings.analytics.retentionDays > 730) return "Analytics retention ต้องอยู่ระหว่าง 7–730 วัน";
  return null;
}

export async function action({ request }: ActionFunctionArgs): Promise<Response | GoSettingsActionData> {
  const session = await requireAdminAccess(request);
  if (session.connection !== "connected") return { ok: false, message: "Core API ยังไม่เชื่อมต่อ จึงยังบันทึก Go settings ไม่ได้" };

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  if (reason.length < 3) return { ok: false, message: "กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษรเพื่อสร้าง audit record" };

  try {
    const api = createAdminApiClient(request);
    if (intent === "save-flag") {
      const flagKey = String(form.get("flagKey") ?? "").trim();
      const rolloutPercent = formInteger(form, "rolloutPercent", 0);
      if (!flagKey || rolloutPercent < 0 || rolloutPercent > 100) {
        return { ok: false, message: "Feature flag หรือ rollout percent ไม่ถูกต้อง" };
      }
      if (!hasAdminPermission(session, "go.settings.manage")) {
        return { ok: false, message: "บัญชีนี้ไม่มีสิทธิ์เปลี่ยน Aevo Go feature flags" };
      }
      await api.requestJson<{ success: true }, { enabled: boolean; rolloutPercent: number; reason: string }>(`/api/v1/admin/go/feature-flags/${encodeURIComponent(flagKey)}`, {
        method: "PATCH",
        headers: requestCsrfHeaders(request),
        body: { enabled: formBoolean(form, "enabled"), rolloutPercent, reason }
      });
      return redirect("/go/settings?saved=flag");
    }

    if (intent !== "save-settings" || !hasAdminPermission(session, "go.settings.manage")) {
      return { ok: false, message: "บัญชีนี้ไม่มีสิทธิ์บันทึก Aevo Go settings" };
    }

    const settings: AevoGoSettings = {
      discovery: {
        searchEnabled: formBoolean(form, "discovery.searchEnabled"),
        mapEnabled: formBoolean(form, "discovery.mapEnabled"),
        defaultRadiusKm: formInteger(form, "discovery.defaultRadiusKm", 15),
        maxResults: formInteger(form, "discovery.maxResults", 50)
      },
      community: {
        traceDeeEnabled: formBoolean(form, "community.traceDeeEnabled"),
        commentsEnabled: formBoolean(form, "community.commentsEnabled"),
        contributionsEnabled: formBoolean(form, "community.contributionsEnabled"),
        requireModeration: formBoolean(form, "community.requireModeration")
      },
      booking: {
        enabled: formBoolean(form, "booking.enabled"),
        holdMinutes: formInteger(form, "booking.holdMinutes", 10),
        maxPartySize: formInteger(form, "booking.maxPartySize", 12)
      },
      notifications: {
        pushEnabled: formBoolean(form, "notifications.pushEnabled"),
        marketingOptInRequired: formBoolean(form, "notifications.marketingOptInRequired")
      },
      privacy: {
        allowGuestBrowse: formBoolean(form, "privacy.allowGuestBrowse"),
        requireAccountToSave: formBoolean(form, "privacy.requireAccountToSave")
      },
      analytics: {
        enabled: formBoolean(form, "analytics.enabled"),
        retentionDays: formInteger(form, "analytics.retentionDays", 90)
      }
    };
    const error = rangeError(settings);
    if (error) return { ok: false, message: error };

    await api.requestJson<{ success: true }, { settings: AevoGoSettings; reason: string }>("/api/v1/admin/go/settings", {
      method: "PATCH",
      headers: requestCsrfHeaders(request),
      body: { settings, reason }
    });
    return redirect("/go/settings?saved=settings");
  } catch (error) {
    return { ok: false, message: error instanceof ApiClientError ? error.message : "บันทึก Aevo Go settings ไม่สำเร็จ" };
  }
}

function SwitchField({ name, label, description, checked, disabled }: { name: string; label: string; description: string; checked: boolean; disabled: boolean }) {
  return (
    <label className="admin-go-switch">
      <span><strong>{label}</strong><small>{description}</small></span>
      <input type="checkbox" name={name} defaultChecked={checked} disabled={disabled} />
    </label>
  );
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="admin-go-settings-heading"><span className="admin-eyebrow">{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>;
}

export default function GoSettingsRoute() {
  const data = useLoaderData() as GoSettingsLoaderData;
  const actionData = useActionData() as GoSettingsActionData | undefined;
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const settings = data.settings;

  if (data.denied) {
    return <Card className="admin-panel"><h1>Aevo Go settings</h1><p className="admin-muted">บัญชีนี้ไม่มีสิทธิ์อ่าน Go settings; ใช้ platform permission แยกจาก organization membership</p></Card>;
  }

  return (
    <>
      <section className="admin-page-heading admin-go-heading">
        <div>
          <span className="admin-eyebrow">Aevo Go / configuration</span>
          <h1>Go settings</h1>
          <p>ตั้งค่า product surface, TraceDee community, booking, privacy และ analytics แยกจาก platform settings ของ Aevo Admin</p>
        </div>
        <div className="admin-page-heading__actions"><Link className="aevo-button aevo-button--secondary" to="/go">กลับ Go dashboard</Link><Link className="aevo-button aevo-button--ghost" to="/audit-logs?app=GO">ดู audit</Link></div>
      </section>

      {data.status !== "connected" ? <OfflineState title="Go settings ยังไม่พร้อมใช้งาน" description={data.message ?? "Core API ยังไม่ส่ง configuration กลับมา"} action={<Link className="aevo-button aevo-button--secondary" to="/connections">ตรวจ Connections</Link>} /> : null}
      {actionData?.ok === false ? <p className="admin-inline-error" role="alert">{actionData.message}</p> : null}
      {searchParams.get("saved") ? <p className="admin-inline-success" role="status">บันทึก {searchParams.get("saved") === "flag" ? "feature flag" : "Go settings"} แล้ว และสร้าง audit record เรียบร้อย</p> : null}

      {settings ? (
        <>
          <Form method="post" className="admin-go-settings-form">
            <input type="hidden" name="intent" value="save-settings" />
            <Card className="admin-panel">
              <SectionHeading eyebrow="01 / discovery" title="Discovery surface" description="ควบคุม search และ map ที่เป็นทางเข้าหลักของ Aevo Go รวมถึงขนาดผลลัพธ์ที่ส่งกลับจาก Customer Gateway" />
              <div className="admin-go-switch-grid">
                <SwitchField name="discovery.searchEnabled" label="Search" description="เปิดการค้นหา store, place และ Trace" checked={settings.discovery.searchEnabled} disabled={!data.canWrite} />
                <SwitchField name="discovery.mapEnabled" label="Map discovery" description="เปิด map viewport และ selected place preview" checked={settings.discovery.mapEnabled} disabled={!data.canWrite} />
              </div>
              <div className="admin-go-form-grid admin-go-form-grid--three">
                <label className="admin-go-field"><span>Default radius (km)</span><Input type="number" name="discovery.defaultRadiusKm" min={1} max={100} defaultValue={settings.discovery.defaultRadiusKm} disabled={!data.canWrite} /></label>
                <label className="admin-go-field"><span>Max results</span><Input type="number" name="discovery.maxResults" min={10} max={200} defaultValue={settings.discovery.maxResults} disabled={!data.canWrite} /></label>
                <div className="admin-go-field admin-go-readonly-field"><span>Map renderer</span><strong>MapLibre / provider adapter</strong><small>ไม่เก็บ provider secret ใน Admin</small></div>
              </div>
            </Card>

            <Card className="admin-panel">
              <SectionHeading eyebrow="02 / TraceDee" title="Community & contribution" description="กำหนดว่าฟีเจอร์ใน product loop จะเปิดให้ผู้ใช้เห็นและส่ง contribution ได้อย่างไร โดย moderation ยังคงเป็น server rule" />
              <div className="admin-go-switch-grid">
                <SwitchField name="community.traceDeeEnabled" label="TraceDee loop" description="Discover → Follow → Journey → Complete" checked={settings.community.traceDeeEnabled} disabled={!data.canWrite} />
                <SwitchField name="community.commentsEnabled" label="Comments v2" description="เปิด depth-one conversation บน community thread" checked={settings.community.commentsEnabled} disabled={!data.canWrite} />
                <SwitchField name="community.contributionsEnabled" label="Contributions" description="ให้ผู้ใช้ส่ง post หลังจบ Journey" checked={settings.community.contributionsEnabled} disabled={!data.canWrite} />
                <SwitchField name="community.requireModeration" label="Require moderation" description="วาง contribution ใหม่ไว้ใน moderation flow ก่อนเผยแพร่" checked={settings.community.requireModeration} disabled={!data.canWrite} />
              </div>
            </Card>

            <Card className="admin-panel">
              <SectionHeading eyebrow="03 / commerce" title="Booking & notifications" description="กำหนดค่าเริ่มต้นของ booking flow และการแจ้งเตือนที่ Aevo Go ขอใช้ผ่าน adapter" />
              <div className="admin-go-switch-grid">
                <SwitchField name="booking.enabled" label="Booking" description="แสดง availability และ booking entry point" checked={settings.booking.enabled} disabled={!data.canWrite} />
                <SwitchField name="notifications.pushEnabled" label="Push notifications" description="อนุญาตให้ client ขอสิทธิ์ push หลัง user action" checked={settings.notifications.pushEnabled} disabled={!data.canWrite} />
                <SwitchField name="notifications.marketingOptInRequired" label="Marketing opt-in" description="ต้องมี consent แยกก่อนส่งข้อความการตลาด" checked={settings.notifications.marketingOptInRequired} disabled={!data.canWrite} />
              </div>
              <div className="admin-go-form-grid admin-go-form-grid--two">
                <label className="admin-go-field"><span>Booking hold (minutes)</span><Input type="number" name="booking.holdMinutes" min={1} max={60} defaultValue={settings.booking.holdMinutes} disabled={!data.canWrite} /></label>
                <label className="admin-go-field"><span>Max party size</span><Input type="number" name="booking.maxPartySize" min={1} max={100} defaultValue={settings.booking.maxPartySize} disabled={!data.canWrite} /></label>
              </div>
            </Card>

            <Card className="admin-panel">
              <SectionHeading eyebrow="04 / trust & measurement" title="Privacy & analytics" description="เก็บสถิติแบบ aggregate เพื่ออ่าน product health โดยไม่ทำให้ client เป็นผู้ตัดสินสิทธิ์หรือ entitlement" />
              <div className="admin-go-switch-grid">
                <SwitchField name="privacy.allowGuestBrowse" label="Guest browse" description="ดู discovery ได้โดยไม่ต้อง sign in" checked={settings.privacy.allowGuestBrowse} disabled={!data.canWrite} />
                <SwitchField name="privacy.requireAccountToSave" label="Account to save" description="ต้อง sign in ก่อน Save หรือ Follow" checked={settings.privacy.requireAccountToSave} disabled={!data.canWrite} />
                <SwitchField name="analytics.enabled" label="Product analytics" description="เก็บ activity event ที่มี schema และ tracking token" checked={settings.analytics.enabled} disabled={!data.canWrite} />
              </div>
              <div className="admin-go-form-grid admin-go-form-grid--two">
                <label className="admin-go-field"><span>Analytics retention policy (days)</span><Input type="number" name="analytics.retentionDays" min={7} max={730} defaultValue={settings.analytics.retentionDays} disabled={!data.canWrite} /><small>Core-owned policy; ไม่มีการลบข้อมูลจาก browser</small></label>
                <div className="admin-go-field admin-go-readonly-field"><span>Data boundary</span><strong>Core API + append-only events</strong><small>Browser ไม่อ่าน tracedee tables โดยตรง</small></div>
              </div>
            </Card>

            <Card className="admin-panel admin-go-save-panel">
              <div><span className="admin-eyebrow">Change control</span><h2>บันทึกการเปลี่ยนแปลง</h2><p className="admin-muted">ทุกการเปลี่ยนค่า Go settings ต้องมีเหตุผลและจะถูกเขียนลง audit logs แบบ structured</p></div>
              <label className="admin-go-field admin-go-reason-field"><span>Reason / ticket</span><Input name="reason" maxLength={1000} placeholder="เช่น GO-1234: enable map discovery for pilot" required disabled={!data.canWrite} /></label>
              <button className="aevo-button aevo-button--primary" type="submit" disabled={!data.canWrite || navigation.state !== "idle"} aria-busy={navigation.state !== "idle"}>{navigation.state !== "idle" ? "กำลังบันทึก…" : "บันทึก Go settings"}</button>
              {data.updatedAt ? <span className="admin-code">Last updated: {new Date(data.updatedAt).toISOString()}</span> : null}
            </Card>
          </Form>

          <Card className="admin-panel">
            <div className="admin-panel__heading"><div><span className="admin-eyebrow">05 / rollout</span><h2>TraceDee feature flags</h2></div><StatusBadge tone={data.canWrite ? "info" : "neutral"}>{data.canWrite ? "Manage with audit" : "Read only"}</StatusBadge></div>
            <p className="admin-muted">Flags เป็น product rollout controls; เปิด/ปิดจากหน้านี้จะไม่แก้ entitlement หรือ bypass server authorization</p>
            <div className="admin-go-feature-table">
              {data.featureFlags.map((flag) => (
                <Form method="post" className="admin-go-feature-row" key={flag.flagKey}>
                  <input type="hidden" name="intent" value="save-flag" />
                  <input type="hidden" name="flagKey" value={flag.flagKey} />
                  <label className="admin-go-feature-name"><input type="checkbox" name="enabled" defaultChecked={flag.enabled} disabled={!data.canWrite} /><span><strong>{flag.flagKey.replaceAll("_", " ")}</strong><small>{flag.config.version ? `config v${String(flag.config.version)}` : "TraceDee rollout flag"}</small></span></label>
                  <label className="admin-go-field admin-go-rollout"><span>Rollout %</span><Input type="number" name="rolloutPercent" min={0} max={100} defaultValue={flag.rolloutPercent} disabled={!data.canWrite} /></label>
                  <label className="admin-go-field admin-go-flag-reason"><span>Reason</span><Input name="reason" maxLength={1000} placeholder="เหตุผล / ticket" required disabled={!data.canWrite} /></label>
                  <button className="aevo-button aevo-button--secondary" type="submit" disabled={!data.canWrite || navigation.state !== "idle"}>บันทึก flag</button>
                </Form>
              ))}
            </div>
          </Card>
        </>
      ) : null}
    </>
  );
}
