import { useEffect, useState, type FormEvent } from "react";
import { useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

interface LoginLoaderData {
  next: string;
}

interface ApiErrorEnvelope {
  error?: { message?: string };
}

interface AdminMeResponse {
  access?: { allowed?: boolean };
}

const adminMeFlights = new Map<string, Promise<AdminMeResponse>>();
let adminRedirectStarted = false;

function runClientSingleFlight<T>(
  flights: Map<string, Promise<T>>,
  key: string,
  factory: () => Promise<T>
): Promise<T> {
  const existing = flights.get(key);
  if (existing) return existing;
  const pending = factory();
  flights.set(key, pending);
  const cleanup = () => {
    if (flights.get(key) === pending) flights.delete(key);
  };
  void pending.then(cleanup, cleanup);
  return pending;
}

function fetchAdminMeOnce(): Promise<AdminMeResponse> {
  return runClientSingleFlight(adminMeFlights, "ADMIN:auth/me", async () => {
    const response = await fetch("/api/auth/me", {
      credentials: "include",
      headers: { accept: "application/json", "x-aevo-app": "ADMIN" }
    });
    const me = await response.json().catch(() => null) as AdminMeResponse | null;
    if (!response.ok || !me) throw new Error("บัญชีนี้ไม่มี platform role สำหรับ Aevo Admin");
    return me;
  });
}

function redirectAdminOnce(target: string): void {
  if (adminRedirectStarted) return;
  adminRedirectStarted = true;
  window.location.assign(target);
}

function safePath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  return value;
}

export function loader({ request }: LoaderFunctionArgs): LoginLoaderData {
  const url = new URL(request.url);
  return { next: safePath(url.searchParams.get("next")) };
}

async function errorMessage(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as ApiErrorEnvelope | null;
  return payload?.error?.message || `Request failed with status ${response.status}`;
}

export default function AdminLoginRoute() {
  const data = useLoaderData() as LoginLoaderData;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const completeLogin = async (): Promise<void> => {
    const me = await fetchAdminMeOnce();
    if (!me.access?.allowed) {
      throw new Error("บัญชีนี้ไม่มี platform role สำหรับ Aevo Admin");
    }
    redirectAdminOnce(data.next);
  };

  useEffect(() => {
    let cancelled = false;
    void completeLogin()
      .catch((error: unknown) => {
        if (!cancelled && error instanceof Error && error.message !== "บัญชีนี้ไม่มี platform role สำหรับ Aevo Admin") {
          setMessage(error.message);
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, rememberMe })
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      await completeLogin();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "เข้าสู่ระบบไม่สำเร็จ");
      setBusy(false);
    }
  };

  return (
    <main className="admin-login-page">
      <section className="admin-login-card" aria-labelledby="admin-login-title">
        <a className="admin-brand" href="/" aria-label="Aevo Admin home">
          <span className="admin-brand__mark" aria-hidden="true">A</span>
          <span><strong>Aevo Admin</strong><small>Platform control plane</small></span>
        </a>
        <div>
          <span className="aevo-eyebrow">Privileged application</span>
          <h1 id="admin-login-title">เข้าสู่ Aevo Admin</h1>
          <p className="admin-login-copy">ใช้สำหรับ platform operator ที่ดูแลแอปและองค์กรใน Aevo Ecosystem</p>
        </div>
        <form className="admin-login-form" onSubmit={(event) => void submit(event)} aria-busy={busy}>
          <label>
            อีเมล
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required />
          </label>
          <label>
            รหัสผ่าน
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
          </label>
          <label className="admin-remember-row">
            <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />
            <span><strong>จดจำอุปกรณ์นี้</strong><small>อย่าเลือกบนเครื่องสาธารณะ</small></span>
          </label>
          {message ? <p className="admin-login-alert" role="alert">{message}</p> : null}
          <button className="aevo-button aevo-button--primary admin-login-submit" type="submit" disabled={busy}>
            {busy ? "กำลังตรวจสอบ…" : "เข้าสู่ระบบ"}
          </button>
        </form>
        <p className="admin-login-foot">Admin session แยกจาก Hub และ Go; browser จะได้รับเฉพาะ opaque HttpOnly cookie และ Core จะเป็นผู้กำหนดอายุ session</p>
      </section>
    </main>
  );
}
