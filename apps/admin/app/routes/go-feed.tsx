import { Activity, Clock3, GitBranch, Gauge, History, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiClientError, defaultFeedDiscoveryConfig, feedDiscoveryModuleIds } from "@aevocado/contracts";
import type {
  FeedConfigActionRequest,
  FeedConfigActiveResponse,
  FeedConfigDraftRequest,
  FeedConfigGuardrailsResponse,
  FeedConfigPropagationResponse,
  FeedConfigPublishRequest,
  FeedConfigRankingMode,
  FeedConfigRevisionPage,
  FeedConfigRevisionResponse,
  FeedConfigRollbackRequest,
  FeedDiscoveryEvaluation,
  FeedEventHealth,
  FeedSavedPlaceReconciliationRequest,
  FeedSavedPlaceReconciliationResponse,
  FeedProjectionHealth,
  FeedSourcesHealth,
  FeedRolloutVariantConfig,
  FeedRuntimeConfig,
  FeedDiscoveryConfig,
  FeedDiscoveryModuleId
} from "@aevocado/contracts";
import { Card, Input, OfflineState, StatusBadge } from "@aevocado/design-system";
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation, useSearchParams, useSubmit } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requestOptional, type DataSourceStatus } from "../lib/admin-resilience.server";
import { createAdminApiClient, requestCsrfHeaders, requireAdminAccess } from "../lib/auth.server";
import { hasAdminPermission, type AdminLoaderData } from "../lib/auth.shared";

interface FeedLoaderData {
  session: AdminLoaderData;
  config: FeedConfigActiveResponse | null;
  guardrails: FeedConfigGuardrailsResponse | null;
  propagation: FeedConfigPropagationResponse | null;
  revisions: FeedConfigRevisionPage | null;
  eventHealth: FeedEventHealth | null;
  discoveryEvaluation: FeedDiscoveryEvaluation | null;
  projectionHealth: FeedProjectionHealth | null;
  sourcesHealth: FeedSourcesHealth | null;
  configStatus: DataSourceStatus;
  guardrailsStatus: DataSourceStatus;
  propagationStatus: DataSourceStatus;
  revisionsStatus: DataSourceStatus;
  eventHealthStatus: DataSourceStatus;
  discoveryEvaluationStatus: DataSourceStatus;
  projectionHealthStatus: DataSourceStatus;
  sourcesHealthStatus: DataSourceStatus;
  canReadConfig: boolean;
  canReadAnalytics: boolean;
  canWriteConfig: boolean;
  canRunMaintenance: boolean;
  message?: string;
}

const fallbackDiscoveryConfig: FeedDiscoveryConfig = {
  intentPrecedence: "EXPLICIT_FIRST",
  intentMatchWeight: 0.35,
  taste: { minimumEvidence: 2, minimumConfidence: 0.4, decayHalfLifeDays: 180, maxAgeDays: 365 },
  modules: { enabled: true, minimumItems: 1, maximumItems: 12, order: ["FOR_YOU"] },
  evidence: { enabled: false, minimumConfidence: 0.7, maxAgeDays: 30 },
  safety: { policyVersion: "ugc-safe-v1", publicEvidenceEnabled: false, publicMediaEnabled: false }
};

const fallbackFeedDiscoveryModuleIds = [
  "FOR_YOU",
  "NEAR_SELECTED_AREA",
  "NEW_AND_USEFUL",
  "COMMUNITY_FAVORITES"
] as const;

const supportedFeedDiscoveryModuleIds = Array.isArray(feedDiscoveryModuleIds) && feedDiscoveryModuleIds.length > 0
  ? feedDiscoveryModuleIds
  : fallbackFeedDiscoveryModuleIds;

function baseDiscoveryConfig(): FeedDiscoveryConfig {
  const defaults = defaultFeedDiscoveryConfig as Partial<FeedDiscoveryConfig> | undefined;
  return {
    ...fallbackDiscoveryConfig,
    ...(defaults ?? {}),
    taste: { ...fallbackDiscoveryConfig.taste, ...(defaults?.taste ?? {}) },
    modules: {
      ...fallbackDiscoveryConfig.modules,
      ...(defaults?.modules ?? {}),
      order: Array.isArray(defaults?.modules?.order) ? defaults.modules.order : fallbackDiscoveryConfig.modules.order
    },
    evidence: { ...fallbackDiscoveryConfig.evidence, ...(defaults?.evidence ?? {}) },
    safety: { ...fallbackDiscoveryConfig.safety, ...(defaults?.safety ?? {}) }
  };
}

type FeedActionData =
  | { ok: false; message: string }
  | { ok: true; reconciliation: FeedSavedPlaceReconciliationResponse };

function deniedResource<T>(message: string) {
  return Promise.resolve({
    data: null as T | null,
    status: "denied" as const,
    message
  });
}

function textField(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

function booleanField(form: FormData, name: string): boolean {
  const value = form.get(name);
  return value === "on" || value === "true";
}

function numberField(form: FormData, name: string): number {
  const raw = textField(form, name);
  const value = Number(raw);
  if (!raw || !Number.isFinite(value)) throw new Error(`${name} ต้องเป็นตัวเลขที่ถูกต้อง`);
  return value;
}

function integerField(form: FormData, name: string): number {
  const value = numberField(form, name);
  if (!Number.isInteger(value)) throw new Error(`${name} ต้องเป็นจำนวนเต็ม`);
  return value;
}

function discoveryModuleOrderField(form: FormData): FeedDiscoveryModuleId[] {
  const ranked: Array<{ moduleId: FeedDiscoveryModuleId; position: number; canonicalPosition: number }> = [];
  for (const [canonicalPosition, moduleId] of supportedFeedDiscoveryModuleIds.entries()) {
    const rawPosition = textField(form, `discovery.modules.order.${moduleId}`);
    if (!rawPosition) continue;
    const position = Number(rawPosition);
    if (Number.isInteger(position) && position >= 1 && position <= supportedFeedDiscoveryModuleIds.length) {
      ranked.push({ moduleId, position, canonicalPosition });
    }
  }
  if (ranked.length > 0) {
    return ranked
      .sort((left, right) => left.position - right.position || left.canonicalPosition - right.canonicalPosition)
      .map(({ moduleId }) => moduleId);
  }

  // Keep accepting the original repeated-value form for old Admin pages and
  // bookmarked/replayed forms created before explicit positions existed.
  const selected: FeedDiscoveryModuleId[] = [];
  for (const value of form.getAll("discovery.modules.order")) {
    const moduleId = String(value);
    if (supportedFeedDiscoveryModuleIds.includes(moduleId as FeedDiscoveryModuleId)
      && !selected.includes(moduleId as FeedDiscoveryModuleId)) {
      selected.push(moduleId as FeedDiscoveryModuleId);
    }
  }
  return selected.length > 0 ? selected : ["FOR_YOU"];
}

function reasonField(form: FormData): string {
  const reason = textField(form, "reason");
  if (reason.length < 3 || reason.length > 1000) throw new Error("กรุณาระบุเหตุผล 3–1000 ตัวอักษรเพื่อสร้าง audit record");
  return reason;
}

function idempotencyKey(form: FormData): string {
  return textField(form, "idempotencyKey") || crypto.randomUUID();
}

function optionalUuidField(form: FormData, name: string): string | null {
  const value = textField(form, name);
  if (!value) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${name} ต้องเป็น UUID ที่ถูกต้องหรือเว้นว่าง`);
  }
  return value;
}

function reconciliationReasonField(form: FormData): string {
  const reason = textField(form, "reconciliationReason");
  if (reason.length < 1 || reason.length > 240) throw new Error("กรุณาระบุเหตุผล reconciliation 1–240 ตัวอักษร");
  return reason;
}

function reconciliationRequestFromForm(form: FormData, key: string): FeedSavedPlaceReconciliationRequest {
  const mode = textField(form, "reconciliationMode");
  if (mode !== "DRY_RUN" && mode !== "MIGRATE" && mode !== "MIGRATE_AND_DELETE") {
    throw new Error("reconciliation mode ไม่ถูกต้อง");
  }
  const limit = integerField(form, "reconciliationLimit");
  if (limit < 1 || limit > 5000) throw new Error("reconciliation limit ต้องอยู่ระหว่าง 1–5000");
  return {
    mode,
    customerId: optionalUuidField(form, "customerId"),
    storeId: optionalUuidField(form, "storeId"),
    limit,
    confirmLegacyDelete: booleanField(form, "confirmLegacyDelete"),
    idempotencyKey: key,
    reason: reconciliationReasonField(form)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function rolloutVariantsField(form: FormData): FeedRolloutVariantConfig[] {
  const raw = textField(form, "rollout.variants");
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("rollout.variants มีรูปแบบไม่ถูกต้อง");
  }
  if (!Array.isArray(parsed)) throw new Error("rollout.variants ต้องเป็นรายการ variant");
  return parsed.map((value, index) => {
    if (!isRecord(value) || typeof value.key !== "string" || typeof value.percent !== "number" || !Number.isFinite(value.percent)) {
      throw new Error(`rollout.variants[${index}] ไม่ถูกต้อง`);
    }
    return { key: value.key, percent: value.percent };
  });
}

function feedConfigFromForm(form: FormData): FeedRuntimeConfig {
  const mode = textField(form, "ranking.mode");
  if (mode !== "DETERMINISTIC" && mode !== "SHADOW" && mode !== "LIVE") {
    throw new Error("ranking.mode ไม่ถูกต้อง");
  }
  const experimentId = textField(form, "rollout.experimentId");
  return {
    schemaVersion: "1",
    enabled: booleanField(form, "enabled"),
    killSwitch: booleanField(form, "killSwitch"),
    candidateSources: {
      trace: {
        enabled: booleanField(form, "candidateSources.trace.enabled"),
        budget: integerField(form, "candidateSources.trace.budget"),
        minimum: integerField(form, "candidateSources.trace.minimum")
      },
      place: {
        enabled: booleanField(form, "candidateSources.place.enabled"),
        budget: integerField(form, "candidateSources.place.budget"),
        minimum: integerField(form, "candidateSources.place.minimum")
      }
    },
    ranking: {
      mode: mode as FeedConfigRankingMode,
      version: textField(form, "ranking.version"),
      freshnessWindowHours: integerField(form, "ranking.freshnessWindowHours"),
      weights: {
        quality: numberField(form, "ranking.weights.quality"),
        freshness: numberField(form, "ranking.weights.freshness"),
        proximity: numberField(form, "ranking.weights.proximity"),
        taste: numberField(form, "ranking.weights.taste")
      }
    },
    diversity: {
      maxConsecutiveSameSource: integerField(form, "diversity.maxConsecutiveSameSource"),
      maxSourceRatio: numberField(form, "diversity.maxSourceRatio"),
      explorationQuota: numberField(form, "diversity.explorationQuota"),
      maxItemsPerCategory: integerField(form, "diversity.maxItemsPerCategory"),
      maxItemsPerArea: integerField(form, "diversity.maxItemsPerArea"),
      maxItemsPerBusiness: integerField(form, "diversity.maxItemsPerBusiness")
    },
    geo: {
      maxCoarseRadiusMeters: integerField(form, "geo.maxCoarseRadiusMeters")
    },
    rollout: {
      percent: integerField(form, "rollout.percent"),
      experimentId: experimentId || null,
      salt: textField(form, "rollout.salt"),
      variants: rolloutVariantsField(form)
    },
    budgets: {
      pageSize: integerField(form, "budgets.pageSize"),
      cacheTtlSeconds: integerField(form, "budgets.cacheTtlSeconds")
    },
    safety: {
      guardrailsEnabled: booleanField(form, "safety.guardrailsEnabled"),
      requireModerationProjection: booleanField(form, "safety.requireModerationProjection"),
      maxEligibilityAgeSeconds: integerField(form, "safety.maxEligibilityAgeSeconds")
    },
    analytics: {
      enabled: booleanField(form, "analytics.enabled"),
      samplePercent: integerField(form, "analytics.samplePercent"),
      retentionDays: integerField(form, "analytics.retentionDays")
    },
    discovery: {
      intentPrecedence: "EXPLICIT_FIRST",
      intentMatchWeight: numberField(form, "discovery.intentMatchWeight"),
      taste: {
        minimumEvidence: integerField(form, "discovery.taste.minimumEvidence"),
        minimumConfidence: numberField(form, "discovery.taste.minimumConfidence"),
        decayHalfLifeDays: integerField(form, "discovery.taste.decayHalfLifeDays"),
        maxAgeDays: integerField(form, "discovery.taste.maxAgeDays")
      },
      modules: {
        enabled: booleanField(form, "discovery.modules.enabled"),
        minimumItems: integerField(form, "discovery.modules.minimumItems"),
        maximumItems: integerField(form, "discovery.modules.maximumItems"),
        order: discoveryModuleOrderField(form)
      },
      evidence: {
        enabled: false,
        minimumConfidence: numberField(form, "discovery.evidence.minimumConfidence"),
        maxAgeDays: integerField(form, "discovery.evidence.maxAgeDays")
      },
      safety: {
        policyVersion: textField(form, "discovery.safety.policyVersion") || baseDiscoveryConfig().safety.policyVersion,
        publicEvidenceEnabled: false,
        publicMediaEnabled: false
      }
    }
  };
}

function revisionIdField(form: FormData): string {
  const revisionId = textField(form, "revisionId");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(revisionId)) {
    throw new Error("revision id ไม่ถูกต้อง");
  }
  return revisionId;
}

function actionMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === "FEED_CONFIG_VERSION_CONFLICT") return "active version เปลี่ยนระหว่างดำเนินการ กรุณาโหลดสถานะล่าสุดแล้วลองใหม่";
    if (error.code === "FEED_CONFIG_NOT_VALIDATED") return "revision นี้ยังไม่ผ่าน server validation";
    if (error.code === "FEED_CONFIG_IDEMPOTENCY_CONFLICT") return "idempotency key นี้ถูกใช้กับ action อื่นแล้ว กรุณาลองส่งใหม่";
    if (error.code === "CSRF_INVALID") return "CSRF token ไม่ถูกต้องหรือหมดอายุ กรุณาโหลดหน้าใหม่";
    if (error.code === "LEGACY_RECONCILIATION_DISABLED") return "legacy reconciliation ปิดอยู่นอก environment ที่อนุมัติให้ทดสอบ/บำรุงรักษา";
    if (error.code === "LEGACY_FAVORITE_HARD_DELETE_DISABLED") return "การลบ legacy ถูกปิดอยู่ ต้องเปิด maintenance hard-delete gate ก่อน";
    if (error.code === "LEGACY_RECONCILIATION_IDEMPOTENCY_CONFLICT") return "idempotency key นี้ถูกใช้กับ reconciliation คนละคำขอ";
    if (error.code === "LEGACY_FAVORITES_SOURCE_UNAVAILABLE") return "ยังไม่พบหรือยังเชื่อมต่อ legacy customer_favorites source ไม่ได้";
    return error.message;
  }
  return error instanceof Error ? error.message : "Feed config mutation ไม่สำเร็จ";
}

export async function action({ request }: ActionFunctionArgs): Promise<Response | FeedActionData> {
  const session = await requireAdminAccess(request);
  const form = await request.formData();
  const intent = textField(form, "intent");
  if (session.connection !== "connected") return { ok: false, message: "Core API ยังไม่เชื่อมต่อ จึงยังดำเนินการ Feed maintenance ไม่ได้" };

  try {
    const api = createAdminApiClient(request);
    const key = idempotencyKey(form);
    const headers = requestCsrfHeaders(request);

    if (intent === "reconcile-legacy-favorites") {
      if (!hasAdminPermission(session, "system.jobs")) return { ok: false, message: "บัญชีนี้ไม่มีสิทธิ์ทำ Feed data maintenance" };
      const body = reconciliationRequestFromForm(form, key);
      const result = await api.requestJson<FeedSavedPlaceReconciliationResponse, FeedSavedPlaceReconciliationRequest>("/api/v1/admin/go/feed/saved-places/reconciliation", {
        method: "POST",
        headers,
        idempotencyKey: key,
        body
      });
      return { ok: true, reconciliation: result };
    }

    if (!hasAdminPermission(session, "go.settings.manage")) return { ok: false, message: "บัญชีนี้ไม่มีสิทธิ์จัดการ Feed config" };

    if (intent === "create-draft") {
      const body: FeedConfigDraftRequest = { config: feedConfigFromForm(form), reason: reasonField(form), idempotencyKey: key };
      const result = await api.requestJson<FeedConfigRevisionResponse, FeedConfigDraftRequest>("/api/v1/admin/go/feed/config/drafts", {
        method: "POST",
        headers,
        idempotencyKey: key,
        body
      });
      return redirect(`/go/feed?draft=${encodeURIComponent(result.revisionId)}&saved=draft`);
    }

    if (intent === "validate") {
      const revisionId = revisionIdField(form);
      const body: FeedConfigActionRequest = { reason: reasonField(form), idempotencyKey: key };
      await api.requestJson<FeedConfigRevisionResponse, FeedConfigActionRequest>(`/api/v1/admin/go/feed/config/drafts/${revisionId}/validate`, {
        method: "POST",
        headers,
        idempotencyKey: key,
        body
      });
      return redirect(`/go/feed?draft=${encodeURIComponent(revisionId)}&saved=validated`);
    }

    if (intent === "publish") {
      const revisionId = revisionIdField(form);
      const expectedActiveVersion = integerField(form, "expectedActiveVersion");
      const body: FeedConfigPublishRequest = { reason: reasonField(form), expectedActiveVersion, idempotencyKey: key };
      await api.requestJson<FeedConfigActiveResponse, FeedConfigPublishRequest>(`/api/v1/admin/go/feed/config/drafts/${revisionId}/publish`, {
        method: "POST",
        headers,
        idempotencyKey: key,
        body
      });
      return redirect("/go/feed?saved=published");
    }

    if (intent === "rollback") {
      const version = integerField(form, "version");
      const expectedActiveVersion = integerField(form, "expectedActiveVersion");
      const body: FeedConfigRollbackRequest = { reason: reasonField(form), expectedActiveVersion, idempotencyKey: key };
      await api.requestJson<FeedConfigActiveResponse, FeedConfigRollbackRequest>(`/api/v1/admin/go/feed/config/revisions/${version}/rollback`, {
        method: "POST",
        headers,
        idempotencyKey: key,
        body
      });
      return redirect("/go/feed?saved=rolled-back");
    }

    return { ok: false, message: "ไม่พบ Feed config action ที่รองรับ" };
  } catch (error) {
    return { ok: false, message: actionMessage(error) };
  }
}

export async function loader({ request }: LoaderFunctionArgs): Promise<FeedLoaderData> {
  const session = await requireAdminAccess(request);
  const canReadConfig = session.connection === "connected" && hasAdminPermission(session, "go.settings.read");
  const canReadAnalytics = session.connection === "connected" && hasAdminPermission(session, "go.analytics.read");
  const canWriteConfig = session.connection === "connected" && hasAdminPermission(session, "go.settings.manage");
  const canRunMaintenance = session.connection === "connected" && hasAdminPermission(session, "system.jobs");

  if (session.connection !== "connected") {
    return {
      session,
      config: null,
      guardrails: null,
      propagation: null,
      revisions: null,
      eventHealth: null,
      discoveryEvaluation: null,
      projectionHealth: null,
      sourcesHealth: null,
      configStatus: session.connection,
      guardrailsStatus: session.connection,
      propagationStatus: session.connection,
      revisionsStatus: session.connection,
      eventHealthStatus: session.connection,
      discoveryEvaluationStatus: session.connection,
      projectionHealthStatus: session.connection,
      sourcesHealthStatus: session.connection,
      canReadConfig,
      canReadAnalytics,
      canWriteConfig,
      canRunMaintenance,
      message: session.connectionMessage
    };
  }

  const api = createAdminApiClient(request);
  const configPromise = canReadConfig
    ? requestOptional<FeedConfigActiveResponse>(api, "/api/v1/admin/go/feed/config")
    : deniedResource<FeedConfigActiveResponse>("บัญชีนี้ไม่มีสิทธิ์อ่าน Feed config");
  const guardrailsPromise = canReadConfig
    ? requestOptional<FeedConfigGuardrailsResponse>(api, "/api/v1/admin/go/feed/guardrails")
    : deniedResource<FeedConfigGuardrailsResponse>("บัญชีนี้ไม่มีสิทธิ์อ่าน Feed guardrails");
  const propagationPromise = canReadConfig
    ? requestOptional<FeedConfigPropagationResponse>(api, "/api/v1/admin/go/feed/propagation")
    : deniedResource<FeedConfigPropagationResponse>("บัญชีนี้ไม่มีสิทธิ์อ่าน Feed propagation");
  const revisionsPromise = canReadConfig
    ? requestOptional<FeedConfigRevisionPage>(api, "/api/v1/admin/go/feed/config/revisions?limit=12")
    : deniedResource<FeedConfigRevisionPage>("บัญชีนี้ไม่มีสิทธิ์อ่าน Feed revisions");
  const eventHealthPromise = canReadAnalytics
    ? requestOptional<FeedEventHealth>(api, "/api/v1/admin/go/feed/events/health")
    : deniedResource<FeedEventHealth>("บัญชีนี้ไม่มีสิทธิ์อ่าน Feed event health");
  const discoveryEvaluationPromise = canReadAnalytics
    ? requestOptional<FeedDiscoveryEvaluation>(api, "/api/v1/admin/go/feed/discovery-evaluation?days=30")
    : deniedResource<FeedDiscoveryEvaluation>("บัญชีนี้ไม่มีสิทธิ์อ่าน Feed discovery evaluation");
  const projectionHealthPromise = canReadAnalytics
    ? requestOptional<FeedProjectionHealth>(api, "/api/v1/admin/go/feed/projections/health")
    : deniedResource<FeedProjectionHealth>("บัญชีนี้ไม่มีสิทธิ์อ่าน Feed projection health");
  const sourcesHealthPromise = canReadAnalytics
    ? requestOptional<FeedSourcesHealth>(api, "/api/v1/admin/go/feed/sources/health")
    : deniedResource<FeedSourcesHealth>("บัญชีนี้ไม่มีสิทธิ์อ่าน Feed source health");

  const [config, guardrails, propagation, revisions, eventHealth, discoveryEvaluation, projectionHealth, sourcesHealth] = await Promise.all([
    configPromise,
    guardrailsPromise,
    propagationPromise,
    revisionsPromise,
    eventHealthPromise,
    discoveryEvaluationPromise,
    projectionHealthPromise,
    sourcesHealthPromise
  ]);

  return {
    session,
    config: config.data,
    guardrails: guardrails.data,
    propagation: propagation.data,
    revisions: revisions.data,
    eventHealth: eventHealth.data,
    discoveryEvaluation: discoveryEvaluation.data,
    projectionHealth: projectionHealth.data,
    sourcesHealth: sourcesHealth.data,
    configStatus: config.status,
    guardrailsStatus: guardrails.status,
    propagationStatus: propagation.status,
    revisionsStatus: revisions.status,
    eventHealthStatus: eventHealth.status,
    discoveryEvaluationStatus: discoveryEvaluation.status,
    projectionHealthStatus: projectionHealth.status,
    sourcesHealthStatus: sourcesHealth.status,
    canReadConfig,
    canReadAnalytics,
    canWriteConfig,
    canRunMaintenance,
    message: [
      config.message,
      guardrails.message,
      propagation.message,
      revisions.message,
      eventHealth.message,
      discoveryEvaluation.message,
      projectionHealth.message,
      sourcesHealth.message
    ].find((value): value is string => Boolean(value))
  };
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

function number(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : new Intl.NumberFormat("en-US").format(value);
}

function rate(value: number | null | undefined): string {
  return value === null || value === undefined
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(value);
}

function statusTone(status: DataSourceStatus | string | null | undefined): "success" | "warning" | "danger" | "neutral" {
  if (status === "connected" || status === "HEALTHY" || status === "ACTIVE" || status === "VALID" || status === "completed") return "success";
  if (status === "denied" || status === "failed" || status === "UNAVAILABLE") return "danger";
  if (status === "degraded" || status === "DEGRADED" || status === "FALLBACK" || status === "PENDING" || status === "started" || status === "rolled_back" || status === "STALE") return "warning";
  return "neutral";
}

function statusLabel(status: DataSourceStatus | string | null | undefined): string {
  if (!status) return "Not reported";
  if (status === "connected") return "Connected";
  if (status === "not_connected") return "Not connected";
  if (status === "denied") return "Permission required";
  if (status === "degraded") return "Degraded";
  return status.replaceAll("_", " ");
}

function ResourceNotice({ title, status, message }: { title: string; status: DataSourceStatus; message?: string }) {
  if (status === "connected") return null;
  if (status === "denied") {
    return (
      <div className="admin-feed-resource-state" role="status">
        <StatusBadge tone="neutral">Permission required</StatusBadge>
        <strong>{title}</strong>
        <p>{message ?? "ต้องมี platform permission ที่เหมาะสมจึงจะอ่าน resource นี้ได้"}</p>
      </div>
    );
  }
  return <OfflineState title={`${title} ยังไม่พร้อมใช้งาน`} description={message ?? "Core API ยังไม่ส่งข้อมูลกลับมา"} action={<Link className="aevo-button aevo-button--secondary" to="/connections">ตรวจ Connections</Link>} />;
}

function BooleanValue({ value }: { value: boolean }) {
  return <StatusBadge tone={value ? "success" : "neutral"}>{value ? "Enabled" : "Disabled"}</StatusBadge>;
}

function DefinitionList({ items }: { items: Array<[string, string | number | null | undefined | ReactNode]> }) {
  return (
    <dl className="admin-feed-definition-list">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

function FeedToggle({ name, label, checked, disabled }: { name: string; label: string; checked: boolean; disabled: boolean }) {
  return (
    <label className="admin-feed-toggle">
      <span>{label}</span>
      <input type="checkbox" name={name} defaultChecked={checked} disabled={disabled} />
    </label>
  );
}

function FeedNumberField({ name, label, value, min, max, step = 1, disabled }: { name: string; label: string; value: number; min?: number; max?: number; step?: number | string; disabled: boolean }) {
  return (
    <label className="admin-feed-field">
      <span>{label}</span>
      <Input type="number" name={name} defaultValue={value} min={min} max={max} step={step} disabled={disabled} />
    </label>
  );
}

const feedConfigDiffFields: Array<[string, (config: FeedRuntimeConfig) => unknown]> = [
  ["enabled", (config) => config.enabled],
  ["killSwitch", (config) => config.killSwitch],
  ["candidateSources.trace.enabled", (config) => config.candidateSources.trace.enabled],
  ["candidateSources.trace.budget", (config) => config.candidateSources.trace.budget],
  ["candidateSources.trace.minimum", (config) => config.candidateSources.trace.minimum],
  ["candidateSources.place.enabled", (config) => config.candidateSources.place.enabled],
  ["candidateSources.place.budget", (config) => config.candidateSources.place.budget],
  ["candidateSources.place.minimum", (config) => config.candidateSources.place.minimum],
  ["ranking.mode", (config) => config.ranking.mode],
  ["ranking.version", (config) => config.ranking.version],
  ["ranking.freshnessWindowHours", (config) => config.ranking.freshnessWindowHours],
  ["ranking.weights.quality", (config) => config.ranking.weights.quality],
  ["ranking.weights.freshness", (config) => config.ranking.weights.freshness],
  ["ranking.weights.proximity", (config) => config.ranking.weights.proximity],
  ["ranking.weights.taste", (config) => config.ranking.weights.taste],
  ["diversity.maxConsecutiveSameSource", (config) => config.diversity.maxConsecutiveSameSource],
  ["diversity.maxSourceRatio", (config) => config.diversity.maxSourceRatio],
  ["diversity.explorationQuota", (config) => config.diversity.explorationQuota],
  ["diversity.maxItemsPerCategory", (config) => config.diversity.maxItemsPerCategory],
  ["diversity.maxItemsPerArea", (config) => config.diversity.maxItemsPerArea],
  ["diversity.maxItemsPerBusiness", (config) => config.diversity.maxItemsPerBusiness],
  ["geo.maxCoarseRadiusMeters", (config) => config.geo.maxCoarseRadiusMeters],
  ["rollout.percent", (config) => config.rollout.percent],
  ["rollout.experimentId", (config) => config.rollout.experimentId],
  ["rollout.salt", (config) => config.rollout.salt],
  ["rollout.variants", (config) => config.rollout.variants],
  ["budgets.pageSize", (config) => config.budgets.pageSize],
  ["budgets.cacheTtlSeconds", (config) => config.budgets.cacheTtlSeconds],
  ["safety.guardrailsEnabled", (config) => config.safety.guardrailsEnabled],
  ["safety.requireModerationProjection", (config) => config.safety.requireModerationProjection],
  ["safety.maxEligibilityAgeSeconds", (config) => config.safety.maxEligibilityAgeSeconds],
  ["analytics.enabled", (config) => config.analytics.enabled],
  ["analytics.samplePercent", (config) => config.analytics.samplePercent],
  ["analytics.retentionDays", (config) => config.analytics.retentionDays],
  ["discovery.intentPrecedence", (config) => config.discovery?.intentPrecedence],
  ["discovery.intentMatchWeight", (config) => config.discovery?.intentMatchWeight],
  ["discovery.taste.minimumEvidence", (config) => config.discovery?.taste.minimumEvidence],
  ["discovery.taste.minimumConfidence", (config) => config.discovery?.taste.minimumConfidence],
  ["discovery.taste.decayHalfLifeDays", (config) => config.discovery?.taste.decayHalfLifeDays],
  ["discovery.taste.maxAgeDays", (config) => config.discovery?.taste.maxAgeDays],
  ["discovery.modules.enabled", (config) => config.discovery?.modules.enabled],
  ["discovery.modules.minimumItems", (config) => config.discovery?.modules.minimumItems],
  ["discovery.modules.maximumItems", (config) => config.discovery?.modules.maximumItems],
  ["discovery.modules.order", (config) => config.discovery?.modules.order],
  ["discovery.evidence.minimumConfidence", (config) => config.discovery?.evidence.minimumConfidence],
  ["discovery.evidence.maxAgeDays", (config) => config.discovery?.evidence.maxAgeDays],
  ["discovery.safety.policyVersion", (config) => config.discovery?.safety?.policyVersion]
];

function displayConfigValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value) ?? "—";
}

function ConfigDiff({ active, candidate }: { active: FeedRuntimeConfig; candidate: FeedRuntimeConfig }) {
  const changes = feedConfigDiffFields.flatMap(([path, read]) => {
    const activeValue = read(active);
    const candidateValue = read(candidate);
    return JSON.stringify(activeValue) === JSON.stringify(candidateValue)
      ? []
      : [{ path, active: displayConfigValue(activeValue), candidate: displayConfigValue(candidateValue) }];
  });

  return (
    <div className="admin-feed-diff" aria-live="polite">
      <div className="admin-panel__heading"><div><span className="admin-eyebrow">Against active revision</span><h3>Field-level diff</h3></div><StatusBadge tone={changes.length > 0 ? "warning" : "success"}>{changes.length > 0 ? `${changes.length} changed` : "No changes"}</StatusBadge></div>
      {changes.length > 0 ? (
        <div className="admin-table-scroll">
          <table className="admin-table admin-feed-table admin-feed-diff-table">
            <thead><tr><th>Field</th><th>Active</th><th>Selected revision</th></tr></thead>
            <tbody>{changes.map((change) => <tr key={change.path}><td className="admin-code">{change.path}</td><td>{change.active}</td><td>{change.candidate}</td></tr>)}</tbody>
          </table>
        </div>
      ) : <p className="admin-muted">ค่าของ revision นี้ตรงกับ active config ทุก field ที่อยู่ใน form</p>}
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

function normalizedDiscoveryConfig(config: FeedRuntimeConfig["discovery"]): FeedDiscoveryConfig {
  const defaults = baseDiscoveryConfig();
  return {
    ...defaults,
    ...(config ?? {}),
    taste: { ...defaults.taste, ...(config?.taste ?? {}) },
    modules: {
      ...defaults.modules,
      ...(config?.modules ?? {}),
      order: Array.isArray(config?.modules?.order) ? config.modules.order : defaults.modules.order
    },
    evidence: { ...defaults.evidence, ...(config?.evidence ?? {}) },
    safety: { ...defaults.safety, ...(config?.safety ?? {}) }
  };
}

function FeedConfigEditor({ config, selectedRevision, canWrite, busy }: { config: FeedRuntimeConfig; selectedRevision: FeedConfigRevisionResponse | null; canWrite: boolean; busy: boolean }) {
  const disabled = !canWrite || busy;
  const discovery = normalizedDiscoveryConfig(config.discovery);
  const moduleOrder = discovery.modules.order.filter((moduleId): moduleId is FeedDiscoveryModuleId => supportedFeedDiscoveryModuleIds.includes(moduleId));
  const effectiveModuleOrder = moduleOrder.length > 0 ? moduleOrder : ["FOR_YOU"] as FeedDiscoveryModuleId[];
  return (
    <Card className="admin-panel admin-feed-editor">
      <div className="admin-panel__heading">
        <div><span className="admin-eyebrow">07 / lifecycle</span><h2>{selectedRevision ? `Edit from revision v${selectedRevision.version}` : "Create typed draft"}</h2><p className="admin-muted">สร้าง revision ใหม่จากค่าที่เลือก; revision เดิม immutable และ Core จะ validate ทั้ง document ก่อน publish</p></div>
        <StatusBadge tone={statusTone(selectedRevision?.status ?? "DRAFT")}>{selectedRevision?.status ?? "New draft"}</StatusBadge>
      </div>
      <Form method="post" className="admin-feed-config-form">
        <input type="hidden" name="intent" value="create-draft" />
        <input type="hidden" name="rollout.variants" value={JSON.stringify(config.rollout.variants)} />
        <input type="hidden" name="discovery.safety.policyVersion" value={discovery.safety.policyVersion} />

        <div className="admin-feed-form-section">
          <span className="admin-eyebrow">Runtime safety</span>
          <div className="admin-feed-toggle-grid">
            <FeedToggle name="enabled" label="Feed enabled" checked={config.enabled} disabled={disabled} />
            <FeedToggle name="killSwitch" label="Kill switch" checked={config.killSwitch} disabled={disabled} />
          </div>
        </div>

        <div className="admin-feed-form-section">
          <span className="admin-eyebrow">Candidate sources</span>
          <div className="admin-feed-form-grid admin-feed-form-grid--three">
            <FeedToggle name="candidateSources.trace.enabled" label="TRACE enabled" checked={config.candidateSources.trace.enabled} disabled={disabled} />
            <FeedNumberField name="candidateSources.trace.budget" label="TRACE budget" value={config.candidateSources.trace.budget} min={0} max={200} disabled={disabled} />
            <FeedNumberField name="candidateSources.trace.minimum" label="TRACE minimum" value={config.candidateSources.trace.minimum} min={0} max={50} disabled={disabled} />
            <FeedToggle name="candidateSources.place.enabled" label="PLACE enabled" checked={config.candidateSources.place.enabled} disabled={disabled} />
            <FeedNumberField name="candidateSources.place.budget" label="PLACE budget" value={config.candidateSources.place.budget} min={0} max={200} disabled={disabled} />
            <FeedNumberField name="candidateSources.place.minimum" label="PLACE minimum" value={config.candidateSources.place.minimum} min={0} max={50} disabled={disabled} />
          </div>
        </div>

        <div className="admin-feed-form-section">
          <span className="admin-eyebrow">Ranking</span>
          <div className="admin-feed-form-grid admin-feed-form-grid--three">
            <label className="admin-feed-field"><span>Mode</span><select name="ranking.mode" defaultValue={config.ranking.mode} className="aevo-control" disabled={disabled}><option value="DETERMINISTIC">DETERMINISTIC</option><option value="SHADOW">SHADOW</option><option value="LIVE">LIVE</option></select></label>
            <label className="admin-feed-field"><span>Ranking version</span><Input name="ranking.version" defaultValue={config.ranking.version} maxLength={64} disabled={disabled} /></label>
            <FeedNumberField name="ranking.freshnessWindowHours" label="Freshness window (hours)" value={config.ranking.freshnessWindowHours} min={1} max={720} disabled={disabled} />
          </div>
          <div className="admin-feed-form-grid admin-feed-form-grid--four">
            <FeedNumberField name="ranking.weights.quality" label="Quality weight" value={config.ranking.weights.quality} min={0} max={1} step="0.01" disabled={disabled} />
            <FeedNumberField name="ranking.weights.freshness" label="Freshness weight" value={config.ranking.weights.freshness} min={0} max={1} step="0.01" disabled={disabled} />
            <FeedNumberField name="ranking.weights.proximity" label="Proximity weight" value={config.ranking.weights.proximity} min={0} max={1} step="0.01" disabled={disabled} />
            <FeedNumberField name="ranking.weights.taste" label="Taste weight" value={config.ranking.weights.taste} min={0} max={1} step="0.01" disabled={disabled} />
          </div>
        </div>

        <div className="admin-feed-form-section">
          <span className="admin-eyebrow">Diversity, rollout & budgets</span>
          <div className="admin-feed-form-grid admin-feed-form-grid--three">
            <FeedNumberField name="diversity.maxConsecutiveSameSource" label="Max same source" value={config.diversity.maxConsecutiveSameSource} min={1} max={5} disabled={disabled} />
            <FeedNumberField name="diversity.maxSourceRatio" label="Max source ratio" value={config.diversity.maxSourceRatio} min={0.5} max={1} step="0.01" disabled={disabled} />
            <FeedNumberField name="diversity.explorationQuota" label="Exploration quota" value={config.diversity.explorationQuota} min={0} max={0.25} step="0.01" disabled={disabled} />
            <FeedNumberField name="diversity.maxItemsPerCategory" label="Max same category" value={config.diversity.maxItemsPerCategory ?? 3} min={1} max={6} disabled={disabled} />
            <FeedNumberField name="diversity.maxItemsPerArea" label="Max same area" value={config.diversity.maxItemsPerArea ?? 4} min={1} max={12} disabled={disabled} />
            <FeedNumberField name="diversity.maxItemsPerBusiness" label="Max same business" value={config.diversity.maxItemsPerBusiness ?? 1} min={1} max={3} disabled={disabled} />
            <FeedNumberField name="geo.maxCoarseRadiusMeters" label="Max coarse radius (m)" value={config.geo.maxCoarseRadiusMeters} min={100} max={50000} disabled={disabled} />
            <FeedNumberField name="rollout.percent" label="Rollout percent" value={config.rollout.percent} min={0} max={100} disabled={disabled} />
            <label className="admin-feed-field"><span>Experiment ID</span><Input name="rollout.experimentId" defaultValue={config.rollout.experimentId ?? ""} maxLength={64} disabled={disabled} /></label>
            <label className="admin-feed-field"><span>Rollout salt</span><Input name="rollout.salt" defaultValue={config.rollout.salt} maxLength={64} disabled={disabled} /></label>
            <FeedNumberField name="budgets.pageSize" label="Page size" value={config.budgets.pageSize} min={1} max={50} disabled={disabled} />
            <FeedNumberField name="budgets.cacheTtlSeconds" label="Cache TTL (seconds)" value={config.budgets.cacheTtlSeconds} min={0} max={300} disabled={disabled} />
          </div>
          <p className="admin-feed-form-help">Variants ที่มีอยู่จะถูกเก็บตาม revision เดิม; การแก้ variant editor จะเปิดใน batch ทดลองแยกเพื่อไม่ให้ rollout ถูกแก้แบบไม่เห็น diff</p>
        </div>

        <div className="admin-feed-form-section">
          <span className="admin-eyebrow">Safety & analytics</span>
          <div className="admin-feed-toggle-grid">
            <FeedToggle name="safety.guardrailsEnabled" label="Guardrails enabled" checked={config.safety.guardrailsEnabled} disabled={disabled} />
            <FeedToggle name="safety.requireModerationProjection" label="Require moderation projection" checked={config.safety.requireModerationProjection} disabled={disabled} />
            <FeedToggle name="analytics.enabled" label="Analytics enabled" checked={config.analytics.enabled} disabled={disabled} />
          </div>
          <div className="admin-feed-form-grid admin-feed-form-grid--three">
            <FeedNumberField name="safety.maxEligibilityAgeSeconds" label="Max eligibility age (seconds)" value={config.safety.maxEligibilityAgeSeconds} min={5} max={3600} disabled={disabled} />
            <FeedNumberField name="analytics.samplePercent" label="Event sample percent" value={config.analytics.samplePercent} min={0} max={100} disabled={disabled} />
            <FeedNumberField name="analytics.retentionDays" label="Retention (days)" value={config.analytics.retentionDays} min={7} max={365} disabled={disabled} />
          </div>
        </div>

        <div className="admin-feed-form-section">
          <span className="admin-eyebrow">Discovery policy</span>
          <p className="admin-feed-form-help">Intent จะมาก่อน taste เสมอ; ค่าหลักฐานและ module เป็น typed controls. Public evidence/media ยังปิดจนกว่า moderation/RLS pipeline จะพร้อม</p>
          <div className="admin-feed-form-grid admin-feed-form-grid--four">
            <FeedNumberField name="discovery.intentMatchWeight" label="Explicit intent weight" value={discovery.intentMatchWeight ?? fallbackDiscoveryConfig.intentMatchWeight ?? 0.35} min={0.05} max={0.8} step="0.01" disabled={disabled} />
            <FeedNumberField name="discovery.taste.minimumEvidence" label="Taste minimum evidence" value={discovery.taste.minimumEvidence} min={2} max={20} disabled={disabled} />
            <FeedNumberField name="discovery.taste.minimumConfidence" label="Taste minimum confidence" value={discovery.taste.minimumConfidence} min={0.4} max={1} step="0.01" disabled={disabled} />
            <FeedNumberField name="discovery.taste.decayHalfLifeDays" label="Taste half-life (days)" value={discovery.taste.decayHalfLifeDays} min={7} max={730} disabled={disabled} />
            <FeedNumberField name="discovery.taste.maxAgeDays" label="Taste max age (days)" value={discovery.taste.maxAgeDays} min={30} max={1095} disabled={disabled} />
            <FeedToggle name="discovery.modules.enabled" label="Discovery modules enabled" checked={discovery.modules.enabled} disabled={disabled} />
            <FeedNumberField name="discovery.modules.minimumItems" label="Module minimum" value={discovery.modules.minimumItems} min={0} max={24} disabled={disabled} />
            <FeedNumberField name="discovery.modules.maximumItems" label="Module maximum" value={discovery.modules.maximumItems} min={1} max={24} disabled={disabled} />
            <div className="admin-feed-module-order">
              <span>Module order (0 = off)</span>
              {supportedFeedDiscoveryModuleIds.map((moduleId) => {
                const position = effectiveModuleOrder.indexOf(moduleId);
                return (
                <label className="admin-feed-module-order-row" key={moduleId}>
                  <span>{moduleId.replaceAll("_", " ")}</span>
                  <select name={`discovery.modules.order.${moduleId}`} defaultValue={String(position >= 0 ? position + 1 : 0)} className="aevo-control" disabled={disabled}>
                    <option value="0">Off</option>
                    {supportedFeedDiscoveryModuleIds.map((_, index) => <option key={index + 1} value={String(index + 1)}>{index + 1}</option>)}
                  </select>
                </label>
                );
              })}
              <small className="admin-feed-form-help">เลือกได้เฉพาะ module ที่มี TRACE/PLACE inventory จริง; ใช้หมายเลข 1–4 เพื่อจัดลำดับ และ Off เพื่อปิด; booking/save/continue จะเปิดเมื่อ projection ของเจ้าของข้อมูลพร้อม</small>
            </div>
            <FeedNumberField name="discovery.evidence.minimumConfidence" label="Evidence minimum confidence" value={discovery.evidence.minimumConfidence} min={0} max={1} step="0.01" disabled={disabled} />
            <FeedNumberField name="discovery.evidence.maxAgeDays" label="Evidence max age (days)" value={discovery.evidence.maxAgeDays} min={1} max={730} disabled={disabled} />
          </div>
        </div>

        <div className="admin-feed-change-control">
          <label className="admin-feed-field"><span>เหตุผล / ticket (audit)</span><Input name="reason" maxLength={1000} placeholder="เช่น FEED-009-MUTATION: tune safe candidate budget" required disabled={disabled} /></label>
          <button className="aevo-button aevo-button--primary" type="submit" disabled={disabled}>{busy ? "กำลังส่ง…" : "สร้าง Feed draft"}</button>
        </div>
      </Form>
    </Card>
  );
}

function FeedRevisionLifecycle({ revision, active, canWrite, busy }: { revision: FeedConfigRevisionResponse; active: FeedConfigActiveResponse | null; canWrite: boolean; busy: boolean }) {
  const disabled = !canWrite || busy;
  const activeVersion = active?.version;
  return (
    <Card className="admin-panel admin-feed-lifecycle">
      <div className="admin-panel__heading">
        <div><span className="admin-eyebrow">Selected revision</span><h2>v{revision.version} lifecycle</h2><p className="admin-muted">revision {revision.revisionId} · สร้างเมื่อ {formatDate(revision.createdAt)}</p></div>
        <StatusBadge tone={statusTone(revision.status)}>{statusLabel(revision.status)}</StatusBadge>
      </div>
      {revision.validation.errors.length > 0 ? <div className="admin-feed-validation-errors" role="alert"><strong>Validation errors</strong><ul>{revision.validation.errors.map((issue) => <li key={`${issue.path}-${issue.code}`}>{issue.path}: {issue.message}</li>)}</ul></div> : null}
      {revision.validation.warnings.length > 0 ? <div className="admin-inline-warning" role="status"><strong>Warnings:</strong> {revision.validation.warnings.map((issue) => `${issue.path}: ${issue.message}`).join(" · ")}</div> : null}
      <div className="admin-feed-action-grid">
        <Form method="post" className="admin-feed-action-card">
          <input type="hidden" name="intent" value="validate" />
          <input type="hidden" name="revisionId" value={revision.revisionId} />
          <div><strong>Server validation</strong><p>ตรวจ schema, bounds และ cross-field rules บน Core ก่อน publish</p></div>
          <label className="admin-feed-field"><span>เหตุผล / ticket</span><Input name="reason" maxLength={1000} required disabled={disabled} /></label>
          <button className="aevo-button aevo-button--secondary" type="submit" disabled={disabled}>{busy ? "กำลังตรวจ…" : "Validate revision"}</button>
        </Form>

        {revision.validation.valid && activeVersion !== null && activeVersion !== undefined && revision.version !== activeVersion ? (
          <Form method="post" className="admin-feed-action-card">
            <input type="hidden" name="intent" value={revision.version < activeVersion ? "rollback" : "publish"} />
            {revision.version < activeVersion ? <input type="hidden" name="version" value={revision.version} /> : <input type="hidden" name="revisionId" value={revision.revisionId} />}
            <input type="hidden" name="expectedActiveVersion" value={activeVersion} />
            <div><strong>{revision.version < activeVersion ? "Rollback active pointer" : "Publish validated draft"}</strong><p>{revision.version < activeVersion ? "สร้าง pointer publication ใหม่โดยไม่แก้หรือลบ history เดิม" : "เลื่อน active pointer แบบ atomic หลังตรวจ optimistic version"}</p></div>
            <label className="admin-feed-field"><span>เหตุผล / incident ticket</span><Input name="reason" maxLength={1000} required disabled={disabled} /></label>
            <HoldSubmitButton label={revision.version < activeVersion ? "rollback" : "publish"} danger={revision.version < activeVersion} disabled={disabled} />
          </Form>
        ) : null}
      </div>
      {active ? <ConfigDiff active={active.config} candidate={revision.config} /> : null}
    </Card>
  );
}

function FeedLegacyFavoriteMaintenance({
  canRun,
  busy,
  result
}: {
  canRun: boolean;
  busy: boolean;
  result: FeedSavedPlaceReconciliationResponse | null;
}) {
  const disabled = !canRun || busy;
  return (
    <Card className="admin-panel admin-feed-maintenance">
      <div className="admin-panel__heading">
        <div>
          <span className="admin-eyebrow">09 / test maintenance</span>
          <h2>Legacy Customer favorites reconciliation</h2>
          <p className="admin-muted">ตรวจสอบหรือย้าย `customer_favorites` ไปยัง Core saved Place projection ผ่าน mapping ที่ตรวจสอบแล้วเท่านั้น</p>
        </div>
        <ShieldCheck size={20} aria-hidden="true" />
      </div>
      <div className="admin-inline-warning" role="note">
        <strong>CONTROLLED TEST PATH</strong> · `DRY_RUN` ไม่เปลี่ยนข้อมูล; `MIGRATE` เพิ่ม canonical save; `MIGRATE_AND_DELETE` ต้องยืนยันและลบ legacy row แบบ exact หลัง save สำเร็จใน transaction เดียว
      </div>
      {canRun ? (
        <Form method="post" className="admin-feed-config-form">
          <input type="hidden" name="intent" value="reconcile-legacy-favorites" />
          <div className="admin-feed-form-section">
            <span className="admin-eyebrow">Scope and action</span>
            <div className="admin-feed-form-grid admin-feed-form-grid--three">
              <label className="admin-feed-field"><span>Mode</span><select name="reconciliationMode" defaultValue="DRY_RUN" className="aevo-control" disabled={disabled}><option value="DRY_RUN">DRY_RUN</option><option value="MIGRATE">MIGRATE</option><option value="MIGRATE_AND_DELETE">MIGRATE_AND_DELETE</option></select></label>
              <label className="admin-feed-field"><span>Limit</span><Input type="number" name="reconciliationLimit" defaultValue={500} min={1} max={5000} step={1} disabled={disabled} /></label>
              <label className="admin-feed-field"><span>Idempotency key (optional)</span><Input name="idempotencyKey" maxLength={200} placeholder="สร้างอัตโนมัติถ้าเว้นว่าง" disabled={disabled} /></label>
              <label className="admin-feed-field"><span>Customer UUID (optional)</span><Input name="customerId" inputMode="text" placeholder="จำกัดลูกค้ารายเดียว" disabled={disabled} /></label>
              <label className="admin-feed-field"><span>Store UUID (optional)</span><Input name="storeId" inputMode="text" placeholder="จำกัดร้านเดียว" disabled={disabled} /></label>
              <label className="admin-feed-toggle"><span>Confirm legacy delete</span><input type="checkbox" name="confirmLegacyDelete" disabled={disabled} /></label>
            </div>
          </div>
          <div className="admin-feed-change-control">
            <label className="admin-feed-field"><span>เหตุผล / test ticket</span><Input name="reconciliationReason" maxLength={240} placeholder="เช่น FEED-015: reconcile controlled fixture" required disabled={disabled} /></label>
            <button className="aevo-button aevo-button--secondary" type="submit" disabled={disabled}>{busy ? "กำลัง reconcile…" : "Run reconciliation"}</button>
          </div>
        </Form>
      ) : (
        <div className="admin-feed-resource-state" role="status">
          <StatusBadge tone="neutral">Permission required</StatusBadge>
          <strong>ต้องมี `system.jobs`</strong>
          <p>เส้นทางนี้เป็น maintenance boundary สำหรับ platform operator เท่านั้น</p>
        </div>
      )}
      {result ? (
        <div className="admin-feed-subsection-grid" aria-live="polite">
          <div>
            <span className="admin-eyebrow">Completed run</span>
            <DefinitionList items={[["Run ID", result.runId], ["Mode", result.mode], ["Request ID", result.requestId], ["Reason", result.reason]]} />
          </div>
          <div>
            <span className="admin-eyebrow">Result counts</span>
            <DefinitionList items={[["Scanned", number(result.scanned)], ["Mapped", number(result.mapped)], ["Unmapped", number(result.unmapped)], ["Ambiguous", number(result.ambiguous)], ["Identity missing", number(result.identityMissing)], ["Not public", number(result.notPublic)], ["Already saved", number(result.alreadySaved)], ["Inserted", number(result.inserted)], ["Deleted legacy", number(result.deletedLegacy)], ["Truncated", result.truncated ? "Yes" : "No"]]} />
          </div>
        </div>
      ) : null}
    </Card>
  );
}

export default function GoFeedRoute() {
  const data = useLoaderData() as FeedLoaderData;
  const actionData = useActionData() as FeedActionData | undefined;
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const config = data.config;
  const guardrails = data.guardrails;
  const propagation = data.propagation;
  const eventHealth = data.eventHealth;
  const discoveryEvaluation = data.discoveryEvaluation;
  const projectionHealth = data.projectionHealth;
  const sourcesHealth = data.sourcesHealth;
  const selectedRevisionId = searchParams.get("draft");
  const selectedRevision = data.revisions?.items.find((revision) => revision.revisionId === selectedRevisionId) ?? null;
  const editorConfig = selectedRevision?.config ?? config?.config ?? null;
  const busy = navigation.state !== "idle";
  const canWrite = data.canWriteConfig && data.configStatus === "connected";
  const saved = searchParams.get("saved");
  const reconciliationResult = actionData?.ok === true ? actionData.reconciliation : null;

  return (
    <>
      <section className="admin-page-heading admin-feed-heading">
        <div>
          <span className="admin-eyebrow">Aevo Go / Feed control plane</span>
          <h1>Feed operations</h1>
          <p>อ่านสถานะ Core-owned config, guardrails, propagation, event intake และ serving projection จากจุดเดียว โดยไม่อ่านฐานข้อมูลหรือเปลี่ยน runtime จาก browser</p>
        </div>
        <div className="admin-page-heading__actions">
          <Link className="aevo-button aevo-button--secondary" to="/go">Go dashboard</Link>
          <Link className="aevo-button aevo-button--ghost" to="/go/feed/moderation">Moderation queue</Link>
          <Link className="aevo-button aevo-button--ghost" to="/go/settings">Go settings</Link>
          <Link className="aevo-button aevo-button--ghost" to="/audit-logs?app=GO">ดู audit</Link>
        </div>
      </section>

      <div className="admin-feed-readonly-note" role="note">
        <ShieldCheck size={17} aria-hidden="true" />
        <span><strong>{canWrite ? "Controlled lifecycle" : "Read-only control"}</strong> · {canWrite ? "draft, server validation, diff, publish และ rollback จะผ่าน Core permission, CSRF, idempotency, optimistic version และ audit" : "ต้องมี go.settings.manage จึงจะสร้าง draft หรือเปลี่ยน active pointer ได้"}</span>
      </div>

      {actionData?.ok === false ? <p className="admin-inline-error" role="alert">{actionData.message}</p> : null}
      {saved ? <p className="admin-inline-success" role="status">{saved === "draft" ? "สร้าง Feed draft แล้ว" : saved === "validated" ? "ตรวจ revision บน Core แล้ว" : saved === "published" ? "publish Feed revision แล้ว" : saved === "rolled-back" ? "rollback Feed active pointer แล้ว" : "ดำเนินการ Feed แล้ว"} และกำลังอ่านสถานะล่าสุดจาก Core</p> : null}

      {!data.canReadConfig && data.configStatus === "denied" ? (
        <div className="admin-feed-permission-grid">
          <ResourceNotice title="Feed configuration" status="denied" message="ต้องมี `go.settings.read` เพื่ออ่าน active config, guardrails, propagation และ revisions" />
          {!data.canReadAnalytics ? <ResourceNotice title="Feed analytics health" status="denied" message="ต้องมี `go.analytics.read` เพื่ออ่าน event และ projection health" /> : null}
        </div>
      ) : null}

      <section className="admin-section-grid">
        <FeedLegacyFavoriteMaintenance canRun={data.canRunMaintenance} busy={busy} result={reconciliationResult} />
      </section>

      <section className="admin-feed-kpi-grid" aria-label="Feed control summary">
        <Card className="admin-kpi"><span>Active version</span><strong>{config?.version ?? "—"}</strong><small>{config?.source ?? "Core config unavailable"}</small></Card>
        <Card className="admin-kpi"><span>Pointer version</span><strong>{config?.pointerVersion ?? "—"}</strong><small>Immutable revision pointer</small></Card>
        <Card className="admin-kpi"><span>Ranking mode</span><strong>{config?.config.ranking.mode ?? "—"}</strong><small>{config?.config.ranking.version ?? "No runtime config"}</small></Card>
        <Card className="admin-kpi"><span>Projection rows</span><strong>{number(projectionHealth?.rowsPublished)}</strong><small>{projectionHealth?.status ?? "Not reported"}</small></Card>
        <Card className="admin-kpi"><span>Event backlog</span><strong>{number(eventHealth?.pending)}</strong><small>{eventHealth ? `${number(eventHealth.failed)} failed · ${number(eventHealth.deadLetter)} dead-letter` : "Not reported"}</small></Card>
      </section>

      {editorConfig ? <FeedConfigEditor config={editorConfig} selectedRevision={selectedRevision} canWrite={canWrite} busy={busy} /> : null}
      {selectedRevision ? <FeedRevisionLifecycle revision={selectedRevision} active={config} canWrite={canWrite} busy={busy} /> : null}

      <section className="admin-section-grid admin-feed-top-grid">
        <Card className="admin-panel admin-panel--wide">
          <div className="admin-panel__heading">
            <div><span className="admin-eyebrow">01 / active config</span><h2>Runtime configuration</h2></div>
            <StatusBadge tone={statusTone(config?.status ?? data.configStatus)}>{statusLabel(config?.status ?? data.configStatus)}</StatusBadge>
          </div>
          <ResourceNotice title="Active Feed config" status={data.configStatus} message={data.message} />
          {config ? (
            <>
              <DefinitionList items={[
                ["Source", config.source],
                ["Revision", config.revisionId],
                ["Schema", config.schemaVersion],
                ["Observed", formatDate(config.observedAt)],
                ["Validation", config.validation.valid ? "Valid" : "Invalid"],
                ["Validator", config.validation.validatorVersion]
              ]} />
              <div className="admin-feed-subsection-grid">
                <div><span className="admin-eyebrow">Ranking</span><DefinitionList items={[["Mode", config.config.ranking.mode], ["Version", config.config.ranking.version], ["Freshness window", `${number(config.config.ranking.freshnessWindowHours)} hours`]]} /></div>
                <div><span className="admin-eyebrow">Rollout</span><DefinitionList items={[["Percent", `${number(config.config.rollout.percent)}%`], ["Experiment", config.config.rollout.experimentId], ["Salt", config.config.rollout.salt]]} /></div>
              </div>
            </>
          ) : null}
        </Card>

        <Card className="admin-panel">
          <div className="admin-panel__heading">
            <div><span className="admin-eyebrow">02 / guardrails</span><h2>Serving safety</h2></div>
            <Gauge size={20} aria-hidden="true" />
          </div>
          <ResourceNotice title="Feed guardrails" status={data.guardrailsStatus} message={data.message} />
          {guardrails ? <DefinitionList items={[
            ["Runtime", <BooleanValue key="runtime" value={guardrails.enabled} />],
            ["Kill switch", <StatusBadge key="kill" tone={guardrails.killSwitch ? "danger" : "success"}>{guardrails.killSwitch ? "ON" : "OFF"}</StatusBadge>],
            ["Guardrails", <BooleanValue key="guardrails" value={guardrails.guardrailsEnabled} />],
            ["Eligibility age", `${number(guardrails.maxEligibilityAgeSeconds)} seconds`],
            ["Coarse radius", `${number(guardrails.maxCoarseRadiusMeters)} meters`],
            ["Event sample", `${number(guardrails.eventSamplePercent)}%`]
          ]} /> : null}
        </Card>
      </section>

      <section className="admin-section-grid">
        <Card className="admin-panel admin-panel--wide">
          <div className="admin-panel__heading">
            <div><span className="admin-eyebrow">03 / propagation</span><h2>Runtime observations</h2></div>
            <GitBranch size={20} aria-hidden="true" />
          </div>
          <ResourceNotice title="Feed propagation" status={data.propagationStatus} message={data.message} />
          {propagation ? (
            <>
              <DefinitionList items={[["Active version", propagation.activeVersion], ["Pointer version", propagation.pointerVersion], ["Runtimes", propagation.runtimes.length], ["Checked", formatDate(propagation.legacyCompatibility.checkedAt)]]} />
              <div className="admin-table-scroll">
                <table className="admin-table admin-feed-table">
                  <thead><tr><th>Runtime</th><th>Status</th><th>Version</th><th>Latency</th><th>Last checked</th></tr></thead>
                  <tbody>{propagation.runtimes.map((runtime) => <tr key={runtime.runtimeName}><td><strong>{runtime.runtimeName}</strong></td><td><StatusBadge tone={statusTone(runtime.status)}>{statusLabel(runtime.status)}</StatusBadge></td><td className="admin-code">{runtime.observedVersion ?? "—"}</td><td>{runtime.latencyMs === null ? "—" : `${runtime.latencyMs} ms`}</td><td>{formatDate(runtime.lastCheckedAt)}</td></tr>)}</tbody>
                </table>
              </div>
              {propagation.legacyCompatibility.mismatchedFlags.length > 0 ? <p className="admin-inline-warning" role="alert">Compatibility mismatch: {propagation.legacyCompatibility.mismatchedFlags.join(", ")}</p> : <p className="admin-inline-success" role="status">Legacy compatibility telemetry reports no mismatch.</p>}
            </>
          ) : null}
        </Card>

        <Card className="admin-panel">
          <div className="admin-panel__heading">
            <div><span className="admin-eyebrow">04 / revisions</span><h2>Recent config history</h2></div>
            <History size={20} aria-hidden="true" />
          </div>
          <ResourceNotice title="Feed revisions" status={data.revisionsStatus} message={data.message} />
          {data.revisions ? <div className="admin-feed-revision-list">{data.revisions.items.length > 0 ? data.revisions.items.slice(0, 12).map((revision) => <div className="admin-feed-revision-row" key={revision.revisionId}><span><strong>v{revision.version}</strong><small>{revision.status} · {formatDate(revision.createdAt)}</small></span><span className="admin-feed-revision-actions"><StatusBadge tone={revision.validation.valid ? "success" : "warning"}>{revision.validation.valid ? "Valid" : "Needs validation"}</StatusBadge><Link className="aevo-button aevo-button--ghost aevo-button--compact" to={`?draft=${encodeURIComponent(revision.revisionId)}`} preventScrollReset>Inspect / diff</Link></span></div>) : <p className="admin-muted">ยังไม่มี config revisions</p>}</div> : null}
        </Card>
      </section>

      <section className="admin-section-grid">
        <Card className="admin-panel admin-panel--wide">
          <div className="admin-panel__heading">
            <div><span className="admin-eyebrow">05 / event intake</span><h2>Event pipeline health</h2></div>
            <Activity size={20} aria-hidden="true" />
          </div>
          <ResourceNotice title="Feed event health" status={data.eventHealthStatus} message={data.message} />
          {eventHealth ? <DefinitionList items={[
            ["Pending", number(eventHealth.pending)],
            ["Processing", number(eventHealth.processing)],
            ["Failed", number(eventHealth.failed)],
            ["Dead-letter", number(eventHealth.deadLetter)],
            ["Accepted / 24h", number(eventHealth.acceptedLast24Hours)],
            ["Processed / 24h", number(eventHealth.processedLast24Hours)],
            ["Last processed", formatDate(eventHealth.lastProcessedAt)],
            ["Consumer", eventHealth.consumerVersion]
          ]} /> : null}
        </Card>

        <Card className="admin-panel">
          <div className="admin-panel__heading">
            <div><span className="admin-eyebrow">06 / serving projection</span><h2>Projection health</h2></div>
            <Clock3 size={20} aria-hidden="true" />
          </div>
          <ResourceNotice title="Feed projection health" status={data.projectionHealthStatus} message={data.message} />
          {projectionHealth ? <DefinitionList items={[
            ["Status", <StatusBadge key="status" tone={statusTone(projectionHealth.status)}>{statusLabel(projectionHealth.status)}</StatusBadge>],
            ["Read mode", projectionHealth.readMode],
            ["Fresh", <BooleanValue key="fresh" value={projectionHealth.fresh} />],
            ["Version", projectionHealth.projectionVersion],
            ["Completed", formatDate(projectionHealth.completedAt)],
            ["Max age", `${number(projectionHealth.maxAgeSeconds)} seconds`],
            ["Last error", projectionHealth.lastErrorCode]
          ]} /> : null}
        </Card>
      </section>

      <section className="admin-section-grid">
        <Card className="admin-panel admin-panel--wide">
          <div className="admin-panel__heading">
            <div><span className="admin-eyebrow">07 / source health</span><h2>Canonical inventory health</h2></div>
            <Gauge size={20} aria-hidden="true" />
          </div>
          <ResourceNotice title="Feed source health" status={data.sourcesHealthStatus} message={data.message} />
          {sourcesHealth ? (
            <>
              <DefinitionList items={[
                ["Adapter", sourcesHealth.source],
                ["Available", <BooleanValue key="available" value={sourcesHealth.available} />],
                ["Checked", formatDate(sourcesHealth.checkedAt)],
                ["Failure", sourcesHealth.failureCode]
              ]} />
              <div className="admin-table-scroll">
                <table className="admin-table admin-feed-table">
                  <thead><tr><th>Source</th><th>Status</th><th>Eligible</th><th>Latest eligible</th><th>Freshness window</th><th>Failure</th></tr></thead>
                  <tbody>{sourcesHealth.sources.map((source) => <tr key={source.source}>
                    <td><strong>{source.source}</strong></td>
                    <td><StatusBadge tone={statusTone(source.status)}>{statusLabel(source.status)}</StatusBadge></td>
                    <td>{number(source.eligibleCount)}</td>
                    <td>{formatDate(source.latestEligibleAt)}</td>
                    <td>{number(source.freshnessWindowSeconds)} seconds</td>
                    <td className="admin-code">{source.failureCode ?? "—"}</td>
                  </tr>)}</tbody>
                </table>
              </div>
            </>
          ) : null}
        </Card>
      </section>

      <section className="admin-section-grid">
        <Card className="admin-panel admin-panel--wide">
          <div className="admin-panel__heading">
            <div><span className="admin-eyebrow">08 / discovery evaluation</span><h2>Outcome and guardrail snapshot</h2></div>
            <Gauge size={20} aria-hidden="true" />
          </div>
          <ResourceNotice title="Feed discovery evaluation" status={data.discoveryEvaluationStatus} message={data.message} />
          {discoveryEvaluation ? (
            <>
              <div className="admin-inline-warning" role="note">
                <strong>INGESTION ONLY</strong> · ตัวเลขนี้เป็น event counts และ guardrail snapshot สำหรับตรวจ coverage เท่านั้น ไม่ใช่ causal attribution และไม่เปลี่ยน ranking runtime
              </div>
              <DefinitionList items={[
                ["Window", `${number(discoveryEvaluation.windowDays)} days`],
                ["Evaluation status", discoveryEvaluation.evaluationStatus],
                ["Ranking mode", discoveryEvaluation.rankingMode],
                ["Live serving", <BooleanValue key="live" value={discoveryEvaluation.liveServing} />],
                ["Generated", formatDate(discoveryEvaluation.generatedAt)],
                ["Open rate", rate(discoveryEvaluation.openRate)],
                ["Booking click rate", rate(discoveryEvaluation.bookingClickRate)]
              ]} />
              <div className="admin-feed-subsection-grid">
                <div>
                  <span className="admin-eyebrow">Outcome counts</span>
                  <DefinitionList items={[
                    ["Impressions", number(discoveryEvaluation.outcomes.impressions)],
                    ["Opens", number(discoveryEvaluation.outcomes.opens)],
                    ["Place opens", number(discoveryEvaluation.outcomes.placeOpens)],
                    ["Saves", number(discoveryEvaluation.outcomes.saves)],
                    ["Trace starts", number(discoveryEvaluation.outcomes.traceStarts)],
                    ["Trace completes", number(discoveryEvaluation.outcomes.traceCompletes)],
                    ["Booking clicks", number(discoveryEvaluation.outcomes.bookingClicks)]
                  ]} />
                </div>
                <div>
                  <span className="admin-eyebrow">Guardrails</span>
                  <DefinitionList items={[
                    ["Current active hides", number(discoveryEvaluation.guardrails.currentActiveHides)],
                    ["Hide transitions", number(discoveryEvaluation.guardrails.hideTransitions)],
                    ["Event dead-letters", number(discoveryEvaluation.guardrails.eventDeadLetters)]
                  ]} />
                </div>
              </div>
            </>
          ) : null}
        </Card>
      </section>
    </>
  );
}
