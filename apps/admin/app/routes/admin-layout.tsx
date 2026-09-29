import { useMemo, useState, useEffect } from "react";
import { Activity, Boxes, Building2, Cable, ClipboardList, CreditCard, Flag, Gauge, LayoutDashboard, LogOut, MapPinned, ScrollText, Search, Settings2, Users } from "lucide-react";
import { Button, StatusBadge } from "@aevocado/design-system";
import { Link, NavLink, Outlet, useLoaderData, useNavigation } from "react-router";
import type { LoaderFunctionArgs, ShouldRevalidateFunctionArgs } from "react-router";
import { requireAdminAccess } from "../lib/auth.server";
import type { AdminLoaderData } from "../lib/auth.shared";
import { AdminUniversalSearch } from "../components/admin-universal-search";
import { createAdminClientDataCache, syncAdminManifest } from "../lib/client-data-cache";
import type { ClientDataCache } from "@aevo/client-data-cache";

export async function loader({ request }: LoaderFunctionArgs): Promise<AdminLoaderData> {
  return requireAdminAccess(request);
}

export function shouldRevalidate({
  formMethod,
  currentUrl,
  nextUrl,
  defaultShouldRevalidate
}: ShouldRevalidateFunctionArgs): boolean {
  // The child route performs its own server-side permission check before
  // loading data. Keep the shell identity stable across menu navigation so a
  // navigation does not replay the same auth request as the child loader.
  if (formMethod && formMethod !== "GET") {
    // User lifecycle mutations can revoke the current identity. Re-read the
    // shell only for that boundary; application, Go, moderation, and Place
    // mutations return their server-confirmed result to the child route and
    // do not change the Admin session.
    return currentUrl.pathname.startsWith("/users/") || nextUrl.pathname.startsWith("/users/");
  }
  if (currentUrl.pathname !== nextUrl.pathname || currentUrl.search !== nextUrl.search) return false;
  return defaultShouldRevalidate;
}

const navigationGroups = [
  {
    label: "Platform",
    items: [
      { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
      { to: "/applications", label: "Applications", icon: Boxes, end: false },
      { to: "/connections", label: "Connections", icon: Cable, end: false },
      { to: "/audit-logs", label: "Audit logs", icon: ScrollText, end: false },
      { to: "/organizations", label: "Organizations", icon: Building2, end: false },
      { to: "/subscriptions", label: "Subscriptions", icon: CreditCard, end: false },
      { to: "/users", label: "Users & access", icon: Users, end: false },
      { to: "/system", label: "System health", icon: Activity, end: false },
      { to: "/map/places", label: "Place registry", icon: MapPinned, end: false },
      { to: "/map/workflows", label: "Place workflows", icon: ClipboardList, end: false }
    ]
  },
  {
    label: "Aevo Go",
    items: [
      { to: "/go", label: "Go dashboard", icon: LayoutDashboard, end: true },
      { to: "/go/feed", label: "Feed control", icon: Gauge, end: true },
      { to: "/go/feed/moderation", label: "Feed moderation", icon: Flag, end: false },
      { to: "/go/search", label: "Search engine", icon: Search, end: false },
      { to: "/go/settings", label: "Go settings", icon: Settings2, end: false }
    ]
  }
] as const;

function readCookie(name: string): string | undefined {
  const prefix = `${name}=`;
  const value = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length);
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function LogoutButton({ clientCache }: { clientCache: ClientDataCache }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function logout(): Promise<void> {
    setBusy(true);
    setMessage("");
    try {
      const csrf = readCookie("aevo_admin_csrf");
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
        headers: {
          accept: "application/json",
          ...(csrf ? { "x-csrf-token": csrf } : {})
        }
      });
      if (!response.ok) throw new Error("ออกจากระบบไม่สำเร็จ");
      await clientCache.logoutCleanup();
      window.location.assign("/login");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ออกจากระบบไม่สำเร็จ");
      setBusy(false);
    }
  }

  return (
    <div className="admin-sidebar-footer__logout">
      <Button type="button" variant="ghost" onClick={() => void logout()} busy={busy} busyLabel="กำลังออกจากระบบ…">
        <LogOut size={15} aria-hidden="true" />
        ออกจากระบบ
      </Button>
      {message ? <span role="alert">{message}</span> : null}
    </div>
  );
}

export default function AdminLayout() {
  const data = useLoaderData() as AdminLoaderData;
  const navigation = useNavigation();
  const clientCache = useMemo(
    () => createAdminClientDataCache(data.me?.user.id ?? "anonymous"),
    [data.me?.user.id]
  );
  useEffect(() => {
    if (data.me) void syncAdminManifest(clientCache).catch(() => undefined);
  }, [clientCache, data.me]);
  const displayName = data.me ? data.me.user.displayName || data.me.user.email : "Session not verified";
  const connectionTone = data.connection === "connected" ? "success" : "warning";
  const connectionLabel = data.connection === "connected"
    ? "Connected"
    : data.connection === "not_connected" ? "Not connected" : "Degraded";

  return (
    <div className="admin-shell">
      <a className="aevo-skip-link" href="#admin-main-content">Skip to content</a>
      <aside className="admin-sidebar" aria-label="Aevo Admin navigation">
        <NavLink className="admin-brand admin-brand--sidebar" to="/">
          <span className="admin-brand__mark" aria-hidden="true">A</span>
          <span><strong>Aevo Admin</strong><small>Platform control plane</small></span>
        </NavLink>
        <div className="admin-context-card">
          <span>Control plane link</span>
          <strong>{data.access?.platformRole ?? "Read-only shell"}</strong>
          <span>{data.connection === "connected" ? "Cross-application operations" : "No privileged data loaded"}</span>
        </div>
        <nav className="admin-nav">
          {navigationGroups.map((group) => (
            <div className="admin-nav-group" key={group.label}>
              <span className="admin-nav-group__label">{group.label}</span>
              {group.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end ?? false}>
                  <Icon size={16} strokeWidth={2} aria-hidden="true" />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="admin-sidebar-footer">
          <span className="admin-sidebar-footer__identity">{displayName}</span>
          <span>{data.connection === "connected" ? "Admin app session verified" : "Session verification pending"}</span>
          {data.me ? <LogoutButton clientCache={clientCache} /> : <Link className="aevo-button aevo-button--ghost" to="/login">เข้าสู่ระบบ</Link>}
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar">
          <div>
            <p>Aevo Admin · server-checked platform boundary</p>
            <span className="admin-topbar__hint">ควบคุมแอป, องค์กร, entitlement และระบบกลางจากจุดเดียว</span>
          </div>
          <AdminUniversalSearch />
          <div className="admin-topbar__actions">
            {navigation.state !== "idle" ? <StatusBadge tone="warning" role="status">กำลังโหลด</StatusBadge> : <StatusBadge tone={connectionTone} role="status">{connectionLabel}</StatusBadge>}
            <span className="admin-role-badge">{data.access?.platformRole ?? "Read-only shell"}</span>
          </div>
        </header>
        {data.connection !== "connected" ? (
          <section className="admin-connection-banner" role="status">
            <StatusBadge tone="warning">{connectionLabel}</StatusBadge>
            <p>{data.connectionMessage}</p>
            <div className="admin-connection-banner__actions">
              <Link className="admin-text-link" to="/connections">ดู Connections</Link>
              <a className="admin-text-link" href="/">ลองใหม่</a>
            </div>
          </section>
        ) : null}
        <main id="admin-main-content" className="admin-content">
          <div className="admin-content__inner"><Outlet /></div>
        </main>
      </div>
    </div>
  );
}
