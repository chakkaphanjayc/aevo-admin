import { index, layout, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  route("health", "./routes/health.ts"),
  route("ready", "./routes/ready.ts"),
  route("api/auth/login", "./routes/api-auth-login.ts"),
  route("api/auth/me", "./routes/api-auth-me.ts"),
  route("api/auth/logout", "./routes/api-auth-logout.ts"),
  route("api/auth/refresh", "./routes/api-auth-refresh.ts"),
  route("api/security/csp-report", "./routes/api-security-csp-report.ts"),
  route("api/v1/access", "./routes/api-v1-access.ts"),
  route("api/v1/sync/manifest", "./routes/api-v1-sync-manifest.ts"),
  route("api/v1/admin/query/execute", "./routes/api-v1-admin-query-execute.ts"),
  route("login", "./routes/login.tsx"),
  layout("./routes/admin-layout.tsx", [
    index("./routes/dashboard.tsx"),
    route("applications", "./routes/applications.tsx"),
    route("applications/:code", "./routes/application-detail.tsx"),
    route("connections", "./routes/connections.tsx"),
    route("audit-logs", "./routes/audit-logs.tsx"),
    route("organizations", "./routes/organizations.tsx"),
    route("organizations/new", "./routes/organization-detail.tsx", { id: "organization-new" }),
    route("organizations/:organizationId", "./routes/organization-detail.tsx", { id: "organization-detail" }),
    route("subscriptions", "./routes/subscriptions.tsx"),
    route("subscriptions/:subscriptionId", "./routes/subscription-detail.tsx"),
    route("users", "./routes/users.tsx"),
    route("users/:userId", "./routes/user-detail.tsx"),
    route("system", "./routes/system.tsx"),
    route("map/places", "./routes/map-places.tsx"),
    route("map/places/:placeId", "./routes/map-place-detail.tsx"),
    route("map/workflows", "./routes/map-workflows.tsx"),
    route("go", "./routes/go-dashboard.tsx"),
    route("go/feed", "./routes/go-feed.tsx"),
    route("go/feed/moderation", "./routes/go-feed-moderation.tsx"),
    route("go/search", "./routes/go-search-engine.tsx"),
    route("go/settings", "./routes/go-settings.tsx")
  ])
] satisfies RouteConfig;
