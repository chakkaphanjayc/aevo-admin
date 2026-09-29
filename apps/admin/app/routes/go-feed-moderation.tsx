import { useEffect, useRef, useState } from "react";
import { Eye, Flag, ShieldCheck } from "lucide-react";
import { ApiClientError } from "@aevocado/contracts";
import type {
  FeedModerationAction,
  FeedModerationActionRequest,
  FeedModerationActionResponse,
  FeedModerationEntityType,
  FeedModerationQueueResponse,
  FeedModerationReport,
  FeedModerationStatus
} from "@aevocado/contracts";
import { Card, Input, OfflineState, StatusBadge } from "@aevocado/design-system";
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation, useSearchParams, useSubmit } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requestOptional, type DataSourceStatus } from "../lib/admin-resilience.server";
import { createAdminApiClient, requestCsrfHeaders, requireAdminAccess } from "../lib/auth.server";
import { hasAdminPermission, type AdminLoaderData } from "../lib/auth.shared";

interface FeedModerationLoaderData {
  session: AdminLoaderData;
  queue: FeedModerationQueueResponse | null;
  status: FeedModerationStatus;
  queueStatus: DataSourceStatus;
  canModerate: boolean;
  message?: string;
}

interface FeedModerationActionData {
  ok: false;
  message: string;
}

const moderationStatuses: FeedModerationStatus[] = ["OPEN", "REVIEWING", "RESOLVED", "DISMISSED"];
const moderationActions: FeedModerationAction[] = ["REVIEW", "LIMIT", "REMOVE", "RESTORE", "DISMISS"];
const snapshotFields: Array<[string, string]> = [
  ["Title", "title"],
  ["Name", "name"],
  ["Body", "body"],
  ["Description", "description"],
  ["Status", "status"],
  ["Moderation", "moderationStatus"],
  ["Visibility", "visibility"],
  ["Area", "area"],
  ["Category", "category"],
  ["Revision", "revision"],
  ["Slug", "slug"]
];

const statusLabels: Record<FeedModerationStatus, string> = {
  OPEN: "เปิดอยู่",
  REVIEWING: "กำลังตรวจสอบ",
  RESOLVED: "จัดการแล้ว",
  DISMISSED: "ยกเลิกการรายงาน"
};

const actionLabels: Record<FeedModerationAction, string> = {
  REVIEW: "ย้ายเป็นกำลังตรวจสอบ",
  LIMIT: "จำกัดการมองเห็น",
  REMOVE: "นำออกจาก public",
  RESTORE: "กู้คืน content",
  DISMISS: "ปิดรายงาน"
};

function textField(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

function idempotencyKey(form: FormData): string {
  return textField(form, "idempotencyKey") || crypto.randomUUID();
}

function reportIdField(form: FormData): string {
  const reportId = textField(form, "reportId");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(reportId)) {
    throw new Error("report id ไม่ถูกต้อง");
  }
  return reportId;
}

function moderationAction(value: string): FeedModerationAction {
  const action = value.toUpperCase() as FeedModerationAction;
  if (!moderationActions.includes(action)) throw new Error("คำสั่ง moderation ไม่ถูกต้อง");
  return action;
}

function moderationStatus(value: string): FeedModerationStatus {
  const status = value.toUpperCase() as FeedModerationStatus;
  if (!moderationStatuses.includes(status)) throw new Error("สถานะ moderation ไม่ถูกต้อง");
  return status;
}

function reasonField(form: FormData): string {
  const reason = textField(form, "reason");
  if (reason.length < 3 || reason.length > 1000) throw new Error("กรุณาระบุเหตุผล 3–1000 ตัวอักษรเพื่อสร้าง audit record");
  return reason;
}

function actionMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === "MODERATION_VERSION_CONFLICT") return "รายงานนี้ถูกเปลี่ยนสถานะแล้ว กรุณาโหลด queue ล่าสุดก่อนดำเนินการต่อ";
    if (error.code === "IDEMPOTENCY_CONFLICT") return "idempotency key นี้ถูกใช้กับ action อื่นแล้ว กรุณาส่งใหม่";
    if (error.code === "CSRF_INVALID") return "CSRF token ไม่ถูกต้องหรือหมดอายุ กรุณาโหลดหน้าใหม่";
    return error.message;
  }
  return error instanceof Error ? error.message : "Feed moderation action ไม่สำเร็จ";
}

export async function action({ request }: ActionFunctionArgs): Promise<Response | FeedModerationActionData> {
  const session = await requireAdminAccess(request);
  if (session.connection !== "connected") return { ok: false, message: "Core API ยังไม่เชื่อมต่อ จึงยังจัดการ Feed moderation ไม่ได้" };
  if (!hasAdminPermission(session, "content.moderate")) return { ok: false, message: "บัญชีนี้ไม่มีสิทธิ์จัดการ Feed moderation" };

  const form = await request.formData();
  try {
    const reportId = reportIdField(form);
    const actionName = moderationAction(textField(form, "action"));
    const expectedReportStatus = moderationStatus(textField(form, "expectedReportStatus"));
    const key = idempotencyKey(form);
    const body: FeedModerationActionRequest = {
      action: actionName,
      expectedReportStatus,
      reason: reasonField(form),
      idempotencyKey: key
    };
    const api = createAdminApiClient(request);
    await api.requestJson<FeedModerationActionResponse, FeedModerationActionRequest>(`/api/v1/admin/go/feed/moderation/${reportId}/actions`, {
      method: "POST",
      headers: requestCsrfHeaders(request),
      idempotencyKey: key,
      body
    });
    const returnStatus = moderationStatus(textField(form, "returnStatus") || expectedReportStatus);
    return redirect(`/go/feed/moderation?status=${encodeURIComponent(returnStatus)}&saved=${encodeURIComponent(actionName.toLowerCase())}`);
  } catch (error) {
    return { ok: false, message: actionMessage(error) };
  }
}

export async function loader({ request }: LoaderFunctionArgs): Promise<FeedModerationLoaderData> {
  const session = await requireAdminAccess(request);
  const url = new URL(request.url);
  const rawStatus = url.searchParams.get("status")?.toUpperCase() ?? "OPEN";
  const status = moderationStatuses.includes(rawStatus as FeedModerationStatus) ? rawStatus as FeedModerationStatus : "OPEN";
  const cursor = url.searchParams.get("cursor");
  const canModerate = session.connection === "connected" && hasAdminPermission(session, "content.moderate");

  if (session.connection !== "connected") {
    return { session, queue: null, status, queueStatus: session.connection, canModerate, message: session.connectionMessage };
  }
  if (!canModerate) {
    return {
      session,
      queue: null,
      status,
      queueStatus: "denied",
      canModerate,
      message: "ต้องมี content.moderate เพื่ออ่านและจัดการ Feed moderation queue"
    };
  }

  const api = createAdminApiClient(request);
  const query = new URLSearchParams({ status, limit: "50" });
  if (cursor) query.set("cursor", cursor);
  const result = await requestOptional<FeedModerationQueueResponse>(api, `/api/v1/admin/go/feed/moderation?${query.toString()}`);
  return { session, queue: result.data, status, queueStatus: result.status, canModerate, message: result.message };
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("th-TH", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Bangkok"
      }).format(date);
}

function statusTone(status: FeedModerationStatus): "danger" | "warning" | "success" | "neutral" {
  if (status === "OPEN") return "danger";
  if (status === "REVIEWING") return "warning";
  if (status === "RESOLVED") return "success";
  return "neutral";
}

function snapshotValue(snapshot: Record<string, unknown>, key: string): string {
  const value = snapshot[key];
  if (typeof value === "string") return value.slice(0, 800);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").join(", ").slice(0, 800);
  return value === null || value === undefined ? "—" : JSON.stringify(value).slice(0, 800);
}

function snapshotHeading(snapshot: Record<string, unknown>): string {
  return snapshotValue(snapshot, "title") !== "—"
    ? snapshotValue(snapshot, "title")
    : snapshotValue(snapshot, "name") !== "—"
      ? snapshotValue(snapshot, "name")
      : snapshotValue(snapshot, "body");
}

function SnapshotPanel({ label, snapshot }: { label: string; snapshot: Record<string, unknown> }) {
  return (
    <div className="admin-feed-moderation-snapshot">
      <span className="admin-eyebrow">{label}</span>
      <strong>{snapshotHeading(snapshot)}</strong>
      <dl>
        {snapshotFields.map(([fieldLabel, key]) => {
          const value = snapshotValue(snapshot, key);
          return value === "—" ? null : <div key={key}><dt>{fieldLabel}</dt><dd>{value}</dd></div>;
        })}
      </dl>
      <small>พิกัดละเอียดและข้อมูลภายในไม่แสดงใน Admin surface นี้</small>
    </div>
  );
}

function HoldSubmitButton({ label, disabled, danger }: { label: string; disabled: boolean; danger?: boolean }) {
  const submit = useSubmit();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);

  const cancel = () => {
    if (timerRef.current !== null) clearInterval(timerRef.current);
    timerRef.current = null;
    setHolding(false);
    setProgress(0);
  };

  useEffect(() => () => {
    if (timerRef.current !== null) clearInterval(timerRef.current);
  }, []);

  const start = () => {
    if (disabled || timerRef.current !== null) return;
    const startedAt = Date.now();
    setHolding(true);
    setProgress(0);
    timerRef.current = setInterval(() => {
      const next = Math.min(100, ((Date.now() - startedAt) / 900) * 100);
      setProgress(next);
      if (next >= 100) {
        if (timerRef.current !== null) clearInterval(timerRef.current);
        timerRef.current = null;
        setHolding(false);
        const form = buttonRef.current?.form;
        if (form) submit(form);
      }
    }, 40);
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`aevo-button ${danger ? "aevo-button--danger" : "aevo-button--primary"} admin-feed-hold-button`}
      disabled={disabled}
      aria-busy={holding}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
          event.preventDefault();
          start();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === "Enter" || event.key === " ") cancel();
      }}
    >
      <span className="admin-feed-hold-button__progress" style={{ width: `${progress}%` }} aria-hidden="true" />
      <span>{holding ? `ค้างต่อเพื่อ${label}` : `ค้างเพื่อ${label}`}</span>
    </button>
  );
}

function ModerationActionForm({ report, action, currentStatus }: { report: FeedModerationReport; action: FeedModerationAction; currentStatus: FeedModerationStatus }) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const needsHold = action === "LIMIT" || action === "REMOVE" || action === "RESTORE";
  return (
    <Form method="post" className="admin-feed-moderation-action-form">
      <input type="hidden" name="reportId" value={report.reportId} />
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="expectedReportStatus" value={report.reportStatus} />
      <input type="hidden" name="returnStatus" value={currentStatus} />
      <label><span className="aevo-sr-only">เหตุผลสำหรับ {actionLabels[action]}</span><Input name="reason" placeholder="เหตุผล / ticket" maxLength={1000} required disabled={busy} /></label>
      {needsHold
        ? <HoldSubmitButton label={action === "REMOVE" ? "นำออกจาก public" : action === "LIMIT" ? "จำกัดการมองเห็น" : "กู้คืน"} danger={action === "REMOVE"} disabled={busy} />
        : <button className="aevo-button aevo-button--secondary" type="submit" disabled={busy}>{busy ? "กำลังบันทึก…" : actionLabels[action]}</button>}
    </Form>
  );
}

function ResourceNotice({ title, status, message }: { title: string; status: DataSourceStatus; message?: string }) {
  if (status === "connected") return null;
  if (status === "denied") {
    return <div className="admin-feed-resource-state" role="status"><StatusBadge tone="neutral">Permission required</StatusBadge><strong>{title}</strong><p>{message ?? "ต้องมี content.moderate จึงจะอ่าน resource นี้ได้"}</p></div>;
  }
  return <OfflineState title={`${title} ยังไม่พร้อมใช้งาน`} description={message ?? "Core API ยังไม่ส่งข้อมูลกลับมา"} action={<Link className="aevo-button aevo-button--secondary" to="/connections">ตรวจ Connections</Link>} />;
}

function isEntityType(value: FeedModerationEntityType): boolean {
  return value !== "PROFILE";
}

export default function GoFeedModerationRoute() {
  const data = useLoaderData() as FeedModerationLoaderData;
  const actionData = useActionData() as FeedModerationActionData | undefined;
  const [searchParams] = useSearchParams();
  const saved = searchParams.get("saved") as FeedModerationAction | null;
  const queue = data.queue;

  return (
    <>
      <section className="admin-page-heading admin-feed-heading">
        <div><span className="admin-eyebrow">Aevo Go / Feed safety</span><h1>Moderation queue</h1><p>อ่าน evidence snapshot และ current content ผ่าน Core boundary ก่อนจำกัด ลบ กู้คืน หรือปิดรายงาน ทุก action ต้องมีเหตุผล, CSRF, idempotency และ optimistic status check</p></div>
        <div className="admin-page-heading__actions"><Link className="aevo-button aevo-button--secondary" to="/go/feed">กลับ Feed control</Link><Link className="aevo-button aevo-button--ghost" to="/audit-logs?app=GO">ดู audit</Link></div>
      </section>

      <div className="admin-feed-readonly-note" role="note"><ShieldCheck size={17} aria-hidden="true" /><span><strong>{data.canModerate ? "Core-authorized moderation" : "Read-only safety surface"}</strong> · {data.canModerate ? "Admin ไม่อ่าน Supabase โดยตรง; Core จะตรวจ content.moderate และจัดการ audit/outbox transaction ให้" : "ต้องมี content.moderate จึงจะอ่าน queue หรือเปลี่ยนสถานะ content ได้"}</span></div>
      {actionData?.ok === false ? <p className="admin-inline-error" role="alert">{actionData.message}</p> : null}
      {saved && actionLabels[saved] ? <p className="admin-inline-success" role="status">{actionLabels[saved]} แล้ว และกำลังอ่าน queue ล่าสุดจาก Core</p> : null}

      <nav className="admin-filter-nav" aria-label="สถานะ Feed moderation">
        {moderationStatuses.map((status) => <Link className={status === data.status ? "is-active" : ""} to={`/go/feed/moderation?status=${status}`} key={status}>{statusLabels[status]}</Link>)}
      </nav>

      <Card className="admin-panel admin-feed-moderation-summary"><div><span className="admin-eyebrow">Queue status</span><h2>{statusLabels[data.status]}</h2><p className="admin-muted">{queue ? `${queue.reports.length} รายการที่โหลดจาก Core API` : "ยังไม่มีข้อมูล queue"}</p></div><StatusBadge tone={statusTone(data.status)}>{queue?.status ?? data.queueStatus}</StatusBadge></Card>
      {data.queueStatus !== "connected" ? <ResourceNotice title="Feed moderation queue" status={data.queueStatus} message={data.message} /> : null}

      {queue && queue.reports.length === 0 ? <Card className="admin-panel admin-state"><Eye size={22} aria-hidden="true" /><h2>ไม่มีรายงานในสถานะนี้</h2><p className="admin-muted">Queue ว่างอยู่ในขณะนี้ หรือเลือกสถานะอื่นเพื่อดูรายการที่มีหลักฐาน</p></Card> : null}
      {queue && queue.reports.length > 0 ? <div className="admin-feed-moderation-list">
        {queue.reports.map((report) => <Card className="admin-panel admin-feed-moderation-card" key={report.reportId}>
          <div className="admin-feed-moderation-card__header"><div className="admin-table-primary"><span className="admin-application-icon"><Flag size={15} aria-hidden="true" /></span><span><strong>{report.entityType}</strong><small>{report.entityId}</small></span></div><StatusBadge tone={statusTone(report.reportStatus)}>{statusLabels[report.reportStatus]}</StatusBadge></div>
          <div className="admin-feed-moderation-meta"><span>Report {report.reportId}</span><span>โดย {report.reporterName}</span><span>{formatDate(report.createdAt)}</span></div>
          <div className="admin-feed-moderation-reason"><strong>{report.reason}</strong><p>{report.details || "ไม่มีรายละเอียดเพิ่มเติม"}</p></div>
          <div className="admin-feed-moderation-grid"><SnapshotPanel label="Evidence snapshot" snapshot={report.evidenceSnapshot} /><SnapshotPanel label="Current content" snapshot={report.currentSnapshot} /></div>
          {report.reportStatus === "OPEN" || report.reportStatus === "REVIEWING" ? <div className="admin-feed-moderation-actions"><ModerationActionForm report={report} action="REVIEW" currentStatus={data.status} />{isEntityType(report.entityType) ? <><ModerationActionForm report={report} action="LIMIT" currentStatus={data.status} /><ModerationActionForm report={report} action="REMOVE" currentStatus={data.status} /></> : null}<ModerationActionForm report={report} action="DISMISS" currentStatus={data.status} /></div> : isEntityType(report.entityType) ? <div className="admin-feed-moderation-actions"><ModerationActionForm report={report} action="RESTORE" currentStatus={data.status} /></div> : <p className="admin-muted">Profile report นี้ไม่มี content state ให้ restore จาก Feed surface</p>}
        </Card>)}
      </div> : null}
      {queue?.nextCursor ? <Link className="aevo-button aevo-button--ghost" to={`/go/feed/moderation?status=${data.status}&cursor=${encodeURIComponent(queue.nextCursor)}`}>โหลดรายการถัดไป</Link> : null}
    </>
  );
}
