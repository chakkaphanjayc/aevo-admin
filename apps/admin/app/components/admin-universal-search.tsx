import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

interface UniversalSearchResult {
  type: string;
  id: string;
  title: string;
  subtitle: string;
  status: string;
  route: string;
}

interface UniversalSearchResponse {
  success: true;
  items: UniversalSearchResult[];
}

const typeLabels: Record<string, string> = {
  organization: "Organization",
  user: "User",
  subscription: "Subscription",
  application: "Application",
  connection: "Connection"
};

export function AdminUniversalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UniversalSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const requestId = useRef(0);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) {
      setResults([]);
      setMessage("");
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const currentRequestId = ++requestId.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setMessage("");
      try {
        const response = await fetch("/api/v1/admin/query/execute", {
          method: "POST",
          credentials: "include",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({
            version: 1,
            model: "admin.directory",
            where: { type: "text", value: normalized },
            pagination: { limit: 20, offset: 0 }
          }),
          signal: controller.signal
        });
        if (!response.ok) throw new Error("Universal search ยังไม่พร้อมใช้งาน");
        const payload = await response.json() as UniversalSearchResponse;
        if (currentRequestId !== requestId.current) return;
        setResults(payload.items ?? []);
        setOpen(true);
      } catch (error) {
        if (controller.signal.aborted || currentRequestId !== requestId.current) return;
        setResults([]);
        setMessage(error instanceof Error ? error.message : "ค้นหาไม่สำเร็จ");
        setOpen(true);
      } finally {
        if (!controller.signal.aborted && currentRequestId === requestId.current) setLoading(false);
      }
    }, 220);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  function clear(): void {
    setQuery("");
    setResults([]);
    setMessage("");
    setOpen(false);
  }

  return (
    <div className="admin-universal-search">
      <Search size={16} aria-hidden="true" />
      <input
        type="search"
        value={query}
        placeholder="ค้นหาทั้ง Admin…"
        aria-label="ค้นหาทั้ง Admin"
        onChange={(event) => {
          setQuery(event.currentTarget.value);
          setOpen(event.currentTarget.value.trim().length >= 2);
        }}
        onFocus={() => {
          if (query.trim().length >= 2) setOpen(true);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 140)}
      />
      {query ? <button type="button" className="admin-universal-search__clear" aria-label="ล้างการค้นหา" onMouseDown={(event) => event.preventDefault()} onClick={clear}><X size={14} aria-hidden="true" /></button> : null}
      {open ? (
        <div className="admin-universal-search__results" role="listbox" aria-label="ผลการค้นหา">
          {loading ? <p className="admin-universal-search__state">กำลังค้นหา…</p> : null}
          {!loading && message ? <p className="admin-universal-search__state admin-universal-search__state--error">{message}</p> : null}
          {!loading && !message && results.length === 0 ? <p className="admin-universal-search__state">ไม่พบผลลัพธ์</p> : null}
          {!loading && !message ? results.map((result) => (
            <Link key={`${result.type}-${result.id}`} to={result.route} className="admin-universal-search__result" role="option" onClick={() => setOpen(false)}>
              <span className="admin-universal-search__result-type">{typeLabels[result.type] ?? result.type}</span>
              <span className="admin-universal-search__result-main"><strong>{result.title}</strong><small>{result.subtitle}</small></span>
              <span className="admin-universal-search__result-status">{result.status}</span>
            </Link>
          )) : null}
        </div>
      ) : null}
    </div>
  );
}
