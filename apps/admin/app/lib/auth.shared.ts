import type {
  AccessDecisionResponse,
  AuthenticatedMeResponse,
  PlatformPermission
} from "@aevocado/api-contract";

export interface AdminLoaderData {
  me: AuthenticatedMeResponse | null;
  access: AccessDecisionResponse | null;
  connection: "connected" | "degraded" | "not_connected";
  connectionMessage: string;
}

export function hasAdminPermission(data: AdminLoaderData, permission: PlatformPermission): boolean {
  return data.connection === "connected" && (data.access?.platformPermissions?.includes(permission) ?? false);
}
