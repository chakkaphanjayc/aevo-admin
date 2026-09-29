import type { ApplicationCode } from "@aevocado/api-contract";

export type ApplicationKind = "CONTROL_PLANE" | "PLATFORM_ADMIN" | "OPERATIONS" | "CONSUMER";
export type ApplicationRegistryStatus = "ACTIVE" | "DISABLED" | "UNKNOWN";
export type ApplicationVisibility = "VISIBLE" | "NOT_CONNECTED";
export type ApplicationRuntimeStatus = "connected" | "degraded" | "not_connected" | "not_configured" | "denied" | "unknown";

export interface AdminApplicationConnection {
  appCode: ApplicationCode;
  label: string;
  status: ApplicationRuntimeStatus;
  baseUrl: string | null;
  checkedAt: string | null;
  latencyMs: number | null;
  lastErrorCode: string | null;
}

export interface AdminApplication {
  code: ApplicationCode;
  name: string;
  kind: ApplicationKind;
  status: ApplicationRegistryStatus;
  visibility: ApplicationVisibility;
  manifestVersion?: string;
  ownerRepository?: string;
  contractVersion?: string;
  audience?: string;
  installScope?: string;
  storeScoped?: boolean;
  launchPath?: string;
  lifecycleStatus?: string;
  capabilities?: string[];
  configSchemaRefs?: string[];
  createdAt: string;
  updatedAt: string;
}

interface KnownApplication {
  code: ApplicationCode;
  name: string;
  kind: ApplicationKind;
}

export const knownApplications: readonly KnownApplication[] = [
  { code: "HUB", name: "Aevo Hub", kind: "CONTROL_PLANE" },
  { code: "ADMIN", name: "Aevo Admin", kind: "PLATFORM_ADMIN" },
  { code: "PLAY", name: "Aevo Play", kind: "CONSUMER" },
  { code: "POS", name: "Aevo POS", kind: "OPERATIONS" },
  { code: "KIOSK", name: "Aevo Kiosk", kind: "OPERATIONS" },
  { code: "QUEUE", name: "Aevo Queue", kind: "OPERATIONS" },
  { code: "GO", name: "Aevo Go", kind: "CONSUMER" },
  { code: "DIGITAL_SIGN", name: "Aevo Digital Sign", kind: "OPERATIONS" }
] as const;

export function disconnectedApplications(): AdminApplication[] {
  return knownApplications.map((application) => ({
    ...application,
    status: "UNKNOWN",
    visibility: "NOT_CONNECTED",
    createdAt: "",
    updatedAt: ""
  }));
}

function applicationKind(value: unknown): ApplicationKind {
  return value === "CONTROL_PLANE" || value === "PLATFORM_ADMIN" || value === "OPERATIONS" || value === "CONSUMER"
    ? value
    : "OPERATIONS";
}

function applicationStatus(value: unknown): ApplicationRegistryStatus {
  return value === "ACTIVE" || value === "DISABLED" ? value : "UNKNOWN";
}

export function normalizeApplications(
  applications: Array<{
    code: ApplicationCode;
    name: string;
    kind: string;
    status: string;
    manifestVersion?: string;
    ownerRepository?: string;
    contractVersion?: string;
    audience?: string;
    installScope?: string;
    storeScoped?: boolean;
    launchPath?: string;
    lifecycleStatus?: string;
    capabilities?: string[];
    configSchemaRefs?: string[];
    createdAt?: string;
    updatedAt?: string;
  }>
): AdminApplication[] {
  return applications.map((application) => ({
    code: application.code,
    name: application.name || application.code,
    kind: applicationKind(application.kind),
    status: applicationStatus(application.status),
    visibility: "VISIBLE",
    manifestVersion: application.manifestVersion,
    ownerRepository: application.ownerRepository,
    contractVersion: application.contractVersion,
    audience: application.audience,
    installScope: application.installScope,
    storeScoped: application.storeScoped,
    launchPath: application.launchPath,
    lifecycleStatus: application.lifecycleStatus,
    capabilities: application.capabilities,
    configSchemaRefs: application.configSchemaRefs,
    createdAt: application.createdAt ?? "",
    updatedAt: application.updatedAt ?? ""
  }));
}

export function applicationByCode(code: ApplicationCode): KnownApplication {
  return knownApplications.find((application) => application.code === code) ?? {
    code,
    name: code,
    kind: "OPERATIONS"
  };
}

export function completeApplicationCatalog(applications: AdminApplication[]): AdminApplication[] {
  const byCode = new Map(applications.map((application) => [application.code, application]));
  return knownApplications.map((known) => byCode.get(known.code) ?? {
    ...known,
    status: "UNKNOWN",
    visibility: "NOT_CONNECTED",
    createdAt: "",
    updatedAt: ""
  });
}

export function normalizeConnections(
  connections: Array<{
    appCode?: unknown;
    applicationCode?: unknown;
    label?: unknown;
    status?: unknown;
    baseUrl?: unknown;
    checkedAt?: unknown;
    latencyMs?: unknown;
    lastErrorCode?: unknown;
  }>
): AdminApplicationConnection[] {
  return connections.flatMap((connection) => {
    const rawCode = connection.appCode ?? connection.applicationCode;
    if (typeof rawCode !== "string" || !knownApplications.some((application) => application.code === rawCode)) return [];
    const status = connection.status === "connected"
      || connection.status === "degraded"
      || connection.status === "not_connected"
      || connection.status === "not_configured"
      ? connection.status
      : "unknown";
    const latency = typeof connection.latencyMs === "number" && Number.isFinite(connection.latencyMs)
      ? Math.max(0, Math.trunc(connection.latencyMs))
      : null;
    return [{
      appCode: rawCode as ApplicationCode,
      label: typeof connection.label === "string" && connection.label.trim().length > 0
        ? connection.label
        : applicationByCode(rawCode as ApplicationCode).name,
      status,
      baseUrl: typeof connection.baseUrl === "string" && connection.baseUrl.trim().length > 0 ? connection.baseUrl : null,
      checkedAt: typeof connection.checkedAt === "string" && connection.checkedAt.length > 0 ? connection.checkedAt : null,
      latencyMs: latency,
      lastErrorCode: typeof connection.lastErrorCode === "string" && connection.lastErrorCode.length > 0 ? connection.lastErrorCode : null
    }];
  });
}
