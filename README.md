# Aevo Admin

Aevo Admin is the privileged platform control plane for the Aevo Ecosystem. It is intentionally maintained and deployed as its own repository and application boundary.

## Local development

```bash
cp .env.example .env
bun install
bun run dev
```

The web app is available at `http://localhost:4335`. Set `AEVO_API_URL` to the Core API deployment that runs the `ADMIN` application boundary.

## Deployment boundary

- Repository: `aevo-admin`
- Production origin: `https://admin.aevo.app`
- Core API: configured through `AEVO_API_URL`
- Browser session: `aevo_admin_session` and `aevo_admin_csrf`
- Authorization: platform RBAC from the Core API, never organization membership alone

The repo contains a thin server-side BFF for browser auth requests. It forwards opaque cookies to the Core API and never exposes a service-role key or direct database access to the browser. Platform data, application registry, entitlements, audit records, and privileged mutations remain owned by the Core API in `aevo-hub` until that service is extracted separately.

When the Core API is unavailable, the shell still renders in read-only mode. It keeps the Connections and Audit logs modules visible, labels the registry as `Not connected`, and disables privileged mutations. It never fabricates platform metrics, permissions, or audit entries.

The main observability routes are:

- `/connections` — Core API status, application registry visibility, and per-app audit links. Runtime health probes remain explicitly `Not configured` until each app exposes a health contract.
- `/audit-logs` — platform-scoped immutable audit records from `GET /api/v1/admin/audit-logs`, filterable by application boundary.
- `/go` — Aevo Go dashboard with aggregate discovery, public stores, booking/order loops, TraceDee, journey, rating, feed, moderation, outbox, feature-flag, and daily activity signals.
- `/go/settings` — Aevo Go configuration surface, kept separate from platform settings. It covers discovery, community, booking, notifications, privacy, analytics, and TraceDee rollout flags.
- `/go/feed` — Core-owned Feed control plane. It reads runtime health and supports typed draft → server validation → diff → audited publish/rollback when `go.settings.manage` is present. Publish and rollback require CSRF, idempotency, optimistic active-version checks, and an accessible hold-to-confirm action.
- `/go/feed/moderation` — Core-authorized Feed moderation queue. It uses `content.moderate`, bounded status/keyset pagination, allowlisted evidence snapshots, typed action conflicts, CSRF/idempotency, and hold-to-confirm for `LIMIT`, `REMOVE`, and `RESTORE`.

Aevo Go settings and dashboard data are owned by the Core API in `aevo-hub`. The Admin server calls `GET /api/v1/admin/go/settings`, `PATCH /api/v1/admin/go/settings`, `PATCH /api/v1/admin/go/feature-flags/:flagKey`, and `GET /api/v1/admin/go/overview`. The browser never talks to Supabase directly. Settings writes are limited to `go.settings.manage` (SUPER_ADMIN by default) and emit structured audit records with the `GO` application code.

If the Core API or the new migration is not connected yet, the routes remain usable as a read-only shell and show `Not connected`/`Read-only shell`; they do not invent metrics or configuration values.

## Checks

```bash
bun run typecheck
bun run build
```

See [docs/REPOSITORY_BOUNDARY.md](docs/REPOSITORY_BOUNDARY.md) for the extraction and deployment contract.
