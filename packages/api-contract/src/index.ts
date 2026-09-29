import type {
  ApiErrorBody,
  AppAccessDecision,
  ApplicationCode,
  Permission,
  PlatformPermission,
  Role,
  TenantContext,
  TenantContextHint
} from "@aevo/contracts";
import { applicationCodes } from "@aevo/contracts";

export type {
  ApiErrorBody,
  AppAccessDecision,
  ApplicationAssignmentStatus,
  ApplicationCode,
  ApplicationScopeType,
  ApplicationScopeSummary,
  AccessDecisionReason,
  MemberApplicationAssignmentSummary,
  Permission,
  PlatformPermission,
  Role,
  TenantContext,
  TenantContextHint
} from "@aevo/contracts";

export const apiContractVersion = 1 as const;

export interface ApiRequestContext {
  requestId: string;
  application: ApplicationCode;
  appVersion: string;
  environment: "development" | "test" | "production";
  organizationId?: string;
  storeId?: string;
}

export interface IdempotencyMetadata {
  key: string;
  scope: string;
}

export interface AccessDecisionResponse extends AppAccessDecision {
  context?: TenantContext;
}

export interface AuthenticatedMeResponse {
  user: {
    id: string;
    email: string;
    displayName?: string;
  };
  principal: {
    userId: string;
    email: string;
    displayName?: string;
    organizationId: string;
    membershipId: string;
    role: Role;
    permissions: Permission[];
  } | null;
  access?: AccessDecisionResponse;
}

export interface AevoGoSettings {
  discovery: {
    searchEnabled: boolean;
    mapEnabled: boolean;
    defaultRadiusKm: number;
    maxResults: number;
  };
  community: {
    traceDeeEnabled: boolean;
    commentsEnabled: boolean;
    contributionsEnabled: boolean;
    requireModeration: boolean;
  };
  booking: {
    enabled: boolean;
    holdMinutes: number;
    maxPartySize: number;
  };
  notifications: {
    pushEnabled: boolean;
    marketingOptInRequired: boolean;
  };
  privacy: {
    allowGuestBrowse: boolean;
    requireAccountToSave: boolean;
  };
  analytics: {
    enabled: boolean;
    retentionDays: number;
  };
}

export interface AevoGoFeatureFlag {
  flagKey: string;
  enabled: boolean;
  rolloutPercent: number;
  config: Record<string, unknown>;
}

export interface AevoGoDailyActivity {
  date: string;
  events: number;
  impressions: number;
  interactions: number;
}

export interface AevoGoOverview {
  asOf: string;
  windowDays: number;
  activePlaces: number;
  publicStores: number;
  publishedTraces: number;
  totalJourneys: number;
  completedJourneys: number;
  bookingsCreated: number;
  bookingsCompleted: number;
  bookingsCancelled: number;
  ordersCreated: number;
  ordersCompleted: number;
  ratingsCount: number;
  averageRating: number;
  openReports: number;
  activityEvents: number;
  feedImpressions: number;
  feedInteractions: number;
  pendingOutbox: number;
  enabledFeatureFlags: number;
  featureFlagCount: number;
  dailyActivity: AevoGoDailyActivity[];
}

export interface ApiErrorEnvelope {
  error: ApiErrorBody["error"];
}

export function isApplicationCode(value: unknown): value is ApplicationCode {
  return typeof value === "string" && applicationCodes.includes(value as ApplicationCode);
}

export function isTenantContextHint(value: unknown): value is TenantContextHint {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (candidate.organizationId === undefined || typeof candidate.organizationId === "string")
    && (candidate.storeId === undefined || typeof candidate.storeId === "string");
}

/**
 * Only same-origin relative paths are valid login return paths. The value is
 * still a hint; the destination application must apply its own access check.
 */
export function isSafeReturnPath(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return false;
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/u.test(value)) return false;
  try {
    const decoded = decodeURIComponent(value);
    return decoded.startsWith("/") && !decoded.startsWith("//") && !decoded.includes("\\");
  } catch {
    return false;
  }
}

export function safeReturnPath(value: unknown, fallback = "/"): string {
  return isSafeReturnPath(value) ? value : fallback;
}
