import { ApiClientError } from "@aevocado/contracts";
import type {
  PlaceAdminDeleteRequest,
  PlaceAdminMutationResponse,
  PlaceAdminPlaceMutationRequest,
  PlaceAdminPlaceResource,
  PlaceStatus
} from "@aevocado/contracts";
import { Card, Input, OfflineState, StatusBadge } from "@aevocado/design-system";
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requestOptional, type DataSourceStatus } from "../lib/admin-resilience.server";
import { createAdminApiClient, requestCsrfHeaders, requireAdminAccess } from "../lib/auth.server";
import { hasAdminPermission, type AdminLoaderData } from "../lib/auth.shared";

const PLACE_STATUSES: readonly PlaceStatus[] = [
  "candidate",
  "visible",
  "limited",
  "under_review",
  "closed",
  "removed",
  "merged"
];

interface MapPlaceDetailLoaderData {
  session: AdminLoaderData;
  place: PlaceAdminPlaceResource | null;
  status: DataSourceStatus;
  denied: boolean;
  message?: string;
}

interface MapPlaceDetailActionData {
  ok: false;
  message: string;
}

export async function loader({ request, params }: LoaderFunctionArgs): Promise<MapPlaceDetailLoaderData> {
  const session = await requireAdminAccess(request);
  const placeId = params.placeId?.trim() ?? "";
  if (session.connection !== "connected") {
    return { session, place: null, status: session.connection, denied: false, message: session.connectionMessage };
  }
  if (!hasAdminPermission(session, "map.places.manage")) {
    return { session, place: null, status: "denied", denied: true, message: "บัญชีนี้ไม่มีสิทธิ์แก้ไขหรือลบ canonical Place" };
  }

  const resource = await requestOptional<PlaceAdminPlaceResource>(
    createAdminApiClient(request),
    `/api/v1/admin/map/places/${encodeURIComponent(placeId)}`
  );
  return {
    session,
    place: resource.data,
    status: resource.status,
    denied: resource.status === "denied",
    message: resource.message
  };
}

function textField(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

function nullablePoint(form: FormData): { longitude: number; latitude: number } | null {
  const longitudeValue = textField(form, "displayLongitude");
  const latitudeValue = textField(form, "displayLatitude");
  if (!longitudeValue && !latitudeValue) return null;
  const longitude = Number(longitudeValue);
  const latitude = Number(latitudeValue);
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error("พิกัดต้องเป็นตัวเลขที่อยู่ในช่วง longitude -180..180 และ latitude -90..90");
  }
  return { longitude, latitude };
}

function mutationReason(form: FormData): string {
  const reason = textField(form, "reason");
  if (reason.length < 3 || reason.length > 500) throw new Error("กรุณาระบุเหตุผล 3–500 ตัวอักษร");
  return reason;
}

export async function action({ request, params }: ActionFunctionArgs): Promise<Response | MapPlaceDetailActionData> {
  const session = await requireAdminAccess(request);
  const placeId = params.placeId?.trim() ?? "";
  if (session.connection !== "connected") return { ok: false, message: "Core API ยังไม่เชื่อมต่อ จึงยังแก้ไขข้อมูลไม่ได้" };
  if (!hasAdminPermission(session, "map.places.manage")) return { ok: false, message: "บัญชีนี้ไม่มีสิทธิ์แก้ไขหรือลบ canonical Place" };

  const form = await request.formData();
  const intent = textField(form, "intent");
  let reason: string;
  try {
    reason = mutationReason(form);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "เหตุผลไม่ถูกต้อง" };
  }

  try {
    const api = createAdminApiClient(request);
    if (intent === "delete") {
      const expectedRevision = Number(textField(form, "expectedRevision"));
      if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
        return { ok: false, message: "ไม่พบ revision ปัจจุบันของ Place" };
      }
      const body: PlaceAdminDeleteRequest = { reason, expectedRevision };
      await api.requestJson<PlaceAdminMutationResponse, PlaceAdminDeleteRequest>(
        `/api/v1/admin/map/places/${encodeURIComponent(placeId)}`,
        { method: "DELETE", headers: requestCsrfHeaders(request), body }
      );
      return redirect("/map/places");
    }

    if (intent !== "update") return { ok: false, message: "ไม่พบ action ที่รองรับ" };
    const detail = await api.request<PlaceAdminPlaceResource>(`/api/v1/admin/map/places/${encodeURIComponent(placeId)}`);
    const slug = textField(form, "slug");
    const name = textField(form, "name");
    const categoryId = textField(form, "categoryId");
    const status = textField(form, "status") as PlaceStatus;
    const sourceRevision = textField(form, "sourceRevision");
    const expectedRevision = Number(textField(form, "expectedRevision"));
    if (!slug || !name || !categoryId || !sourceRevision || !PLACE_STATUSES.includes(status)) {
      return { ok: false, message: "slug, name, category, status และ source revision ต้องไม่ว่าง" };
    }
    if (!Number.isInteger(expectedRevision) || expectedRevision !== detail.revision) {
      return { ok: false, message: "revision ไม่ตรงกับข้อมูลล่าสุด กรุณาโหลดหน้าใหม่" };
    }
    const displayPoint = nullablePoint(form);
    const summary = {
      ...detail.summary,
      slug,
      name,
      status,
      category: { ...detail.summary.category, id: categoryId },
      displayPoint,
      labelPoint: displayPoint ?? detail.summary.labelPoint
    };
    const body: PlaceAdminPlaceMutationRequest = {
      summary,
      canonicalGeometry: detail.canonicalGeometry,
      boundingGeometry: detail.boundingGeometry,
      sourceKind: detail.sourceKind,
      sourceId: detail.sourceId,
      evidenceReference: detail.evidenceReference,
      sourceRevision,
      reason,
      expectedRevision,
      projectionVersion: detail.projectionVersion
    };
    await api.requestJson<PlaceAdminMutationResponse, PlaceAdminPlaceMutationRequest>(
      `/api/v1/admin/map/places/${encodeURIComponent(placeId)}`,
      { method: "PUT", headers: requestCsrfHeaders(request), body }
    );
    return redirect(`/map/places/${encodeURIComponent(placeId)}`);
  } catch (error) {
    return { ok: false, message: error instanceof ApiClientError ? error.message : error instanceof Error ? error.message : "Place mutation ไม่สำเร็จ" };
  }
}

function tone(value: string | null): "success" | "warning" | "neutral" {
  if (value === "active" || value === "fresh" || value === "visible") return "success";
  if (value === "stale" || value === "failed" || value === "candidate" || value === "under_review") return "warning";
  return "neutral";
}

export default function MapPlaceDetailRoute() {
  const data = useLoaderData() as MapPlaceDetailLoaderData;
  const actionData = useActionData() as MapPlaceDetailActionData | undefined;
  const navigation = useNavigation();
  const place = data.place;

  if (data.denied) {
    return <Card className="admin-panel"><h1>Place editor</h1><p className="admin-muted">{data.message ?? "บัญชีนี้ไม่มีสิทธิ์แก้ไขหรือลบ canonical Place"}</p></Card>;
  }
  if (!place) {
    return <OfflineState title="Place editor ยังไม่พร้อมใช้งาน" description={data.message ?? "ไม่พบ canonical Place detail จาก Core API"} action={<Link className="aevo-button aevo-button--secondary" to="/map/places">กลับไป registry</Link>} />;
  }

  const busy = navigation.state !== "idle";
  return (
    <>
      <section className="admin-page-heading">
        <div>
          <span className="admin-eyebrow">Map / canonical registry / edit</span>
          <h1>{place.summary.name}</h1>
          <p>แก้ไข canonical fields ผ่าน Core API ด้วย optimistic revision และ audit reason; geometry กับ nested fields ที่ไม่ได้แก้จะถูกเก็บเดิมไว้</p>
        </div>
        <div className="admin-page-heading__actions">
          <StatusBadge tone={tone(place.projectionStatus)}>{place.projectionStatus ?? "not built"}</StatusBadge>
          <Link className="aevo-button aevo-button--ghost" to="/map/places">กลับ registry</Link>
        </div>
      </section>

      {actionData?.ok === false ? <p className="admin-inline-error" role="alert">{actionData.message}</p> : null}

      <Card className="admin-panel">
        <Form method="post" className="admin-go-form-grid">
          <input type="hidden" name="intent" value="update" />
          <input type="hidden" name="expectedRevision" value={place.revision} />
          <label className="admin-go-field"><span>Slug</span><Input name="slug" defaultValue={place.summary.slug} maxLength={240} required disabled={busy} /></label>
          <label className="admin-go-field"><span>Name</span><Input name="name" defaultValue={place.summary.name} maxLength={500} required disabled={busy} /></label>
          <label className="admin-go-field"><span>Category ID</span><Input name="categoryId" defaultValue={place.summary.category.id} maxLength={200} required disabled={busy} /></label>
          <label className="admin-go-field"><span>Lifecycle</span><select name="status" defaultValue={place.summary.status} className="aevo-control" disabled={busy}>{PLACE_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
          <label className="admin-go-field"><span>Display longitude</span><Input type="number" name="displayLongitude" defaultValue={place.summary.displayPoint?.longitude ?? ""} min={-180} max={180} step="any" disabled={busy} /></label>
          <label className="admin-go-field"><span>Display latitude</span><Input type="number" name="displayLatitude" defaultValue={place.summary.displayPoint?.latitude ?? ""} min={-90} max={90} step="any" disabled={busy} /></label>
          <label className="admin-go-field"><span>Source revision</span><Input name="sourceRevision" defaultValue={place.sourceRevision} maxLength={256} required disabled={busy} /></label>
          <label className="admin-go-field" style={{ gridColumn: "1 / -1" }}><span>เหตุผล / ticket (audit)</span><Input name="reason" placeholder="เช่น MAP-TEST-001: update fixture" maxLength={500} required disabled={busy} /></label>
          <div className="admin-page-heading__actions" style={{ gridColumn: "1 / -1" }}><button className="aevo-button aevo-button--primary" type="submit" disabled={busy}>{busy ? "กำลังบันทึก…" : "บันทึก Place"}</button><span className="admin-muted">revision ปัจจุบัน: r{place.revision}</span></div>
        </Form>
      </Card>

      <Card className="admin-panel">
        <div className="admin-page-heading">
          <div><span className="admin-eyebrow">Test lifecycle control</span><h2>Soft delete</h2><p>การลบจาก Admin เป็น soft delete: เปลี่ยนเป็น <code>removed</code>, ปิด public projection และเก็บ immutable revision/audit history ไว้</p></div>
        </div>
        <Form method="post" onSubmit={(event) => { if (!window.confirm("ยืนยัน soft delete Place นี้หรือไม่?")) event.preventDefault(); }} className="admin-inline-form">
          <input type="hidden" name="intent" value="delete" />
          <input type="hidden" name="expectedRevision" value={place.revision} />
          <Input name="reason" placeholder="เหตุผลการลบ / test ticket" maxLength={500} required disabled={busy} aria-label="เหตุผล soft delete" />
          <button className="aevo-button aevo-button--ghost" type="submit" disabled={busy}>Soft delete Place</button>
        </Form>
      </Card>
    </>
  );
}
