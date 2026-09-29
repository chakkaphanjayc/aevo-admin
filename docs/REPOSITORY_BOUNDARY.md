# Aevo Admin repository boundary

## Ownership

`aevo-admin` owns the privileged web control plane, its server-rendered routes, its same-origin browser BFF, and the Admin-specific presentation layer.

`aevo-core-api`/Infrastructure owns the canonical Core API, database migrations,
application registry, platform RBAC, audit trail, billing and entitlement
state, and the `/api/v1/admin/*` domain handlers. The Admin UI must treat that
API as the source of truth. `aevo-hub` is the identity entrypoint and keeps
only transitional provider/compatibility adapters.

The other first-party applications (`aevo-go`, `aevo-play`, `aevo-pos`, and future clients) keep their own repositories and deployment boundaries.

## Runtime contract

Production deploys the Admin repo independently at `admin.aevo.app`.

The Admin server calls `AEVO_API_URL` from server-only loaders/actions. Browser auth requests are handled by the local BFF routes and proxied to the Core API with the request cookie. The browser receives only the app-scoped opaque session cookie; it never receives a Supabase service-role credential.

The Core API must enforce all of the following on every privileged request:

- `application=ADMIN` app-scoped session validation;
- platform role and permission checks, separate from organization membership;
- active `application_registry` state;
- CSRF validation for state-changing browser requests;
- audit logging for privileged mutations;
- `GET /api/v1/admin/audit-logs` protected by `audit.read` for the Admin audit viewer;
- the self-protection rule that Admin cannot disable its own application boundary.

The Admin UI treats registry visibility and runtime health as separate signals. A visible row in `application_registry` means the Core API can read the boundary record; it does not claim that the deployed app runtime is healthy. Per-app runtime probes must be added to the Core API contract before they are shown as connected.

## Aevo Go control plane

Aevo Go has its own Admin navigation group so product operations do not mix with platform operations:

- `/go` is the read-oriented dashboard for discovery, public stores, booking/order loops, TraceDee community, journeys, ratings, feed activity, moderation, outbox health, feature flags, and daily activity.
- `/go/settings` is the configuration surface for discovery, community, booking, notifications, privacy, analytics, and TraceDee rollout flags.
- `/audit-logs` remains the canonical cross-application audit view; Go mutations are marked with `application_code=GO` and target `aevo_go_settings/default` or a TraceDee feature flag.

The source of truth is Core API: the `aevo_go_settings` singleton, the bounded
`aevo_go_admin_overview` aggregate, platform permission defaults, and the
`/api/v1/admin/go/*` handlers live there. `aevo-admin` only renders and submits
typed requests through its server-side BFF. The dashboard intentionally shows
an unavailable state until the Core API and migration are connected; it does
not fall back to fabricated values.

The configuration boundary is deliberately server-owned. Secrets, provider credentials, and customer records are not part of the Go settings JSON. Settings writes require `go.settings.manage`, are CSRF-protected, validate bounded values, and create a structured audit record with a required reason/ticket.

## Map / Place control plane

`/map/places` is the initial read-only canonical Place registry shell. Its
loader calls Core through the existing server-only BFF at
`GET /api/v1/admin/map/places` and requires the platform permission
`map.places.read`. It shows lifecycle, display-point, source-revision, and
public-projection freshness fields without exposing a browser database
credential or enabling canonical writes. Claims, submissions, merges, and
rollback actions remain separate Core commands with their own permission,
CSRF, idempotency, and audit gates.

`/map/workflows` is the companion read-only queue for claim, community
submission, and Place relationship records. It calls
`GET /api/v1/admin/map/workflows` through the same BFF and deliberately reports
that review actions are disabled until the workflow command gates are approved.

Payment-provider secrets/webhooks, tax/coupon rules, cancellation/refund policy, loyalty, quests, and push-device registration remain excluded until Aevo Go has a canonical Core API contract that enforces them. The Admin UI must not expose a field that only changes presentation without changing the server rule.

## Shared code policy

The initial standalone repo carries the small client, contract, access, auth, and design-system packages needed to build independently. These packages are compatibility snapshots while the package publishing boundary is established.

The next consolidation step is to publish versioned `@aevocado/api-contract`, `@aevocado/api-client`, and design-system packages from a dedicated package pipeline. Production code must depend on released versions rather than `file:` paths or imports into `aevo-hub`.

## Migration sequence

1. Deploy this repo against the existing Core API in an isolated preview origin.
2. Run Admin login, app-access, read, mutation, cookie-isolation, and SSO integration tests against that Core API.
3. Point `admin.aevo.app` to this deployment.
4. Remove the transitional `aevo-hub/apps/admin` web workspace only after the new deployment is healthy.
5. Keep the Core API Admin handlers until a separately deployable Core/API boundary is intentionally extracted.
