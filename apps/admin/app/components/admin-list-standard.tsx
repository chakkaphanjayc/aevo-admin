import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Form, Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { Button, DataTable, Input, Select } from "@aevocado/design-system";

export interface AdminListFilter {
  name: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
}

export interface AdminListColumn<Row> {
  key: string;
  label: string;
  sortable?: boolean;
  defaultVisible?: boolean;
  render: (row: Row) => ReactNode;
  exportValue?: (row: Row) => string;
}

export interface AdminListBulkAction<Row> {
  key: string;
  label: string;
  onAction: (rows: Row[]) => void;
  disabled?: boolean;
  danger?: boolean;
}

interface AdminListStandardProps<Row> {
  listKey: string;
  caption: string;
  rows: Row[];
  columns: AdminListColumn<Row>[];
  getRowId: (row: Row) => string;
  emptyMessage: string;
  query: string;
  placeholder: string;
  filters?: AdminListFilter[];
  page: number;
  limit: number;
  limitOptions?: number[];
  hasMore: boolean;
  sort: string;
  direction: "asc" | "desc";
  createHref?: string;
  createLabel?: string;
  bulkActions?: AdminListBulkAction<Row>[];
  recordLabel?: string;
  nextPageHref?: string;
  previousPageHref?: string;
}

function quoteCsv(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function downloadCsv<Row>(
  rows: Row[],
  columns: AdminListColumn<Row>[],
  visibleKeys: Set<string>,
  filename: string
): void {
  const exportableColumns = columns.filter((column) => visibleKeys.has(column.key));
  const header = exportableColumns.map((column) => quoteCsv(column.label)).join(",");
  const body = rows.map((row) => exportableColumns.map((column) => quoteCsv(column.exportValue?.(row) ?? "")).join(","));
  const blob = new Blob([[header, ...body].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function withQuery(pathname: string, current: URLSearchParams, changes: Record<string, string | null>): string {
  const next = new URLSearchParams(current);
  Object.entries(changes).forEach(([key, value]) => {
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
  });
  const search = next.toString();
  return search ? `${pathname}?${search}` : pathname;
}

export function AdminListStandard<Row>({
  listKey,
  caption,
  rows,
  columns,
  getRowId,
  emptyMessage,
  query,
  placeholder,
  filters = [],
  page,
  limit,
  limitOptions = [10, 25, 50],
  hasMore,
  sort,
  direction,
  createHref,
  createLabel,
  bulkActions = [],
  recordLabel = "รายการ",
  nextPageHref,
  previousPageHref
}: AdminListStandardProps<Row>) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const defaultVisibleKeys = useMemo(
    () => columns.filter((column) => column.defaultVisible !== false).map((column) => column.key),
    [columns]
  );
  const [visibleKeys, setVisibleKeys] = useState<string[]>(defaultVisibleKeys);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [columnsReady, setColumnsReady] = useState(false);
  const filterState = filters.map((filter) => `${filter.name}=${filter.value}`).join("&");

  useEffect(() => {
    const stored = window.localStorage.getItem(`aevo-admin:list-columns:${listKey}`);
    if (!stored) {
      setColumnsReady(true);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.every((key): key is string => typeof key === "string")) {
        const known = new Set(columns.map((column) => column.key));
        setVisibleKeys(parsed.filter((key) => known.has(key)));
      }
    } catch {
      window.localStorage.removeItem(`aevo-admin:list-columns:${listKey}`);
    }
    setColumnsReady(true);
  }, [columns, listKey]);

  useEffect(() => {
    if (!columnsReady) return;
    window.localStorage.setItem(`aevo-admin:list-columns:${listKey}`, JSON.stringify(visibleKeys));
  }, [columnsReady, listKey, visibleKeys]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [filterState, limit, listKey, page, query, sort, direction]);

  const visibleColumns = columns.filter((column) => visibleKeys.includes(column.key));
  const selectedRows = rows.filter((row) => selectedIds.has(getRowId(row)));
  const allVisibleSelected = rows.length > 0 && rows.every((row) => selectedIds.has(getRowId(row)));

  function toggleColumn(key: string): void {
    setVisibleKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }

  function toggleAllRows(): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) rows.forEach((row) => next.delete(getRowId(row)));
      else rows.forEach((row) => next.add(getRowId(row)));
      return next;
    });
  }

  function toggleRow(row: Row): void {
    const id = getRowId(row);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function changeSort(key: string): void {
    const nextDirection = sort === key && direction === "asc" ? "desc" : "asc";
    navigate(withQuery(location.pathname, searchParams, { sort: key, direction: nextDirection, page: "1" }), { preventScrollReset: true });
  }

  function changeLimit(nextLimit: string): void {
    navigate(withQuery(location.pathname, searchParams, { limit: nextLimit, page: "1" }), { preventScrollReset: true });
  }

  function exportSelected(): void {
    downloadCsv(selectedRows, columns, new Set(visibleKeys), `${listKey}-selected.csv`);
  }

  const defaultActions: AdminListBulkAction<Row>[] = [
    { key: "export", label: "ส่งออกที่เลือก", onAction: exportSelected }
  ];

  return (
    <CardLike>
      <div className="admin-list-standard__toolbar">
        <Form method="get" id={`admin-list-form-${listKey}`} className="admin-list-standard__search" role="search">
          <label className="admin-go-field admin-list-standard__query"><span>ค้นหา</span><Input type="search" name="q" defaultValue={query} placeholder={placeholder} maxLength={200} /></label>
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="direction" value={direction} />
          <input type="hidden" name="limit" value={String(limit)} />
          <input type="hidden" name="page" value="1" />
          <Button type="submit" variant="secondary">ค้นหา</Button>
          {query || filters.some((filter) => filter.value) ? <Link className="aevo-button aevo-button--ghost" to={location.pathname}>ล้างตัวกรอง</Link> : null}
        </Form>
        <div className="admin-list-standard__controls">
          <details className="admin-list-standard__advanced">
            <summary>ตัวกรองขั้นสูง{filters.some((filter) => filter.value) ? " · ใช้งานอยู่" : ""}</summary>
            <div className="admin-list-standard__advanced-body">
              <p className="admin-muted">ใช้ตัวกรองร่วมกับคำค้นหาได้ และค่าทั้งหมดจะอยู่ใน URL เพื่อแชร์หรือย้อนกลับได้</p>
              {filters.map((filter) => <label className="admin-go-field" key={`advanced-${filter.name}`}><span>{filter.label}</span><Select name={filter.name} form={`admin-list-form-${listKey}`} defaultValue={filter.value}>{filter.options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</Select></label>)}
            </div>
          </details>
          <label className="admin-list-standard__limit"><span>ต่อหน้า</span><Select value={String(limit)} onChange={(event) => changeLimit(event.currentTarget.value)} aria-label="จำนวนรายการต่อหน้า">{limitOptions.map((option) => <option value={option} key={option}>{option}</option>)}</Select></label>
          <button type="button" className="aevo-button aevo-button--secondary" aria-expanded={columnsOpen} onClick={() => setColumnsOpen((open) => !open)}>คอลัมน์</button>
          {createHref && createLabel ? <Link className="aevo-button aevo-button--primary" to={createHref}>+ {createLabel}</Link> : null}
          {columnsOpen ? <fieldset className="admin-list-standard__columns"><legend>แสดงคอลัมน์</legend>{columns.map((column) => <label key={column.key}><input type="checkbox" checked={visibleKeys.includes(column.key)} disabled={visibleKeys.length === 1 && visibleKeys.includes(column.key)} onChange={() => toggleColumn(column.key)} />{column.label}</label>)}</fieldset> : null}
        </div>
      </div>

      {selectedRows.length > 0 ? <div className="admin-list-standard__selection" role="status" aria-live="polite"><strong>เลือกแล้ว {selectedRows.length} รายการ</strong><span className="admin-muted">การกระทำจะทำกับรายการในหน้าปัจจุบัน</span><div className="admin-list-standard__actions">{[...defaultActions, ...bulkActions].map((action) => <Button key={action.key} type="button" variant={action.danger ? "danger" : "secondary"} disabled={action.disabled} onClick={() => action.onAction(selectedRows)}>{action.label}</Button>)}</div></div> : null}

      <div className="admin-list-standard__meta"><span className="admin-muted">แสดง {rows.length} {recordLabel} · หน้า {page} · สูงสุด {limit} ต่อหน้า</span><span className="admin-muted">เลือกได้หลายรายการ</span></div>
      <DataTable caption={caption}>
        <div className="admin-table-scroll">
          <table className="admin-table admin-table--standard">
            <thead><tr><th className="admin-list-standard__check"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAllRows} aria-label="เลือกทุกแถวในหน้านี้" /></th>{visibleColumns.map((column) => <th key={column.key}>{column.sortable ? <button type="button" className="admin-list-standard__sort" onClick={() => changeSort(column.key)} aria-label={`เรียงตาม ${column.label} ${sort === column.key && direction === "desc" ? "จากน้อยไปมาก" : "จากมากไปน้อย"}`}>{column.label}<span aria-hidden="true">{sort === column.key ? direction === "asc" ? " ↑" : " ↓" : " ↕"}</span></button> : column.label}</th>)}</tr></thead>
            <tbody>{rows.map((row) => { const rowId = getRowId(row); return <tr key={rowId}><td className="admin-list-standard__check"><input type="checkbox" checked={selectedIds.has(rowId)} onChange={() => toggleRow(row)} aria-label={`เลือก ${rowId}`} /></td>{visibleColumns.map((column) => <td key={`${rowId}-${column.key}`}>{column.render(row)}</td>)}</tr>; })}{rows.length === 0 ? <tr><td colSpan={visibleColumns.length + 1} className="admin-muted">{emptyMessage}</td></tr> : null}</tbody>
          </table>
        </div>
      </DataTable>
      <div className="admin-list-standard__footer"><span className="admin-muted">{selectedRows.length > 0 ? `เลือก ${selectedRows.length} จาก ${rows.length} รายการในหน้า` : "ยังไม่ได้เลือกรายการ"}</span><nav className="admin-directory-toolbar__pagination" aria-label="แบ่งหน้า"><Link className={`aevo-button aevo-button--ghost${page <= 1 && !previousPageHref ? " is-disabled" : ""}`} aria-disabled={page <= 1 && !previousPageHref} tabIndex={page <= 1 && !previousPageHref ? -1 : undefined} to={previousPageHref ?? (page <= 1 ? location.pathname : withQuery(location.pathname, searchParams, { page: String(page - 1) }))}>ก่อนหน้า</Link><span className="admin-muted">หน้า {page}</span><Link className={`aevo-button aevo-button--ghost${!hasMore ? " is-disabled" : ""}`} aria-disabled={!hasMore} tabIndex={!hasMore ? -1 : undefined} to={nextPageHref ?? (!hasMore ? location.pathname : withQuery(location.pathname, searchParams, { page: String(page + 1) }))}>ถัดไป</Link></nav></div>
    </CardLike>
  );
}

function CardLike({ children }: { children: ReactNode }) {
  return <section className="aevo-card admin-panel admin-list-standard">{children}</section>;
}
