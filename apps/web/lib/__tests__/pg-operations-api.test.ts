import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchApi } = vi.hoisted(() => ({ fetchApi: vi.fn() }));

vi.mock("../api", () => ({ fetchApi }));

import {
  addMaintenanceComment,
  addResidenceMaintenanceComment,
  completeMaintenancePhotos,
  completeResidenceMaintenancePhotos,
  confirmAssignmentMoveOut,
  createResidenceMaintenance,
  fetchMaintenanceAnalytics,
  fetchMaintenanceCategories,
  fetchMaintenanceTimeline,
  getMaintenanceTicket,
  getResidenceMaintenanceTicket,
  getOperatorBedDetail,
  getManagedProperty,
  getTenantResidence,
  getOccupancySummary,
  listAssignments,
  listBedMaintenance,
  listPropertyMaintenance,
  listResidenceMaintenance,
  moveInBed,
  moveOutAssignmentNow,
  operatorMoveOutRequest,
  relistBed,
  reopenResidenceMaintenance,
  resolveMaintenanceTicket,
  reserveBed,
  serveTenantNotice,
  acceptTenantOperatorMoveOut,
  rejectTenantOperatorMoveOut,
  requestTenantMoveOut,
  presignMaintenancePhotos,
  presignResidenceMaintenancePhotos,
  updateMaintenanceStatus,
  updateBedStatus,
  addMaintenanceInternalNote,
  overrideMaintenancePriority
} from "../pg-operations-api";

describe("pg operations API client", () => {
  beforeEach(() => {
    fetchApi.mockReset();
  });

  it("passes filters and the bearer token to the occupancy endpoint", () => {
    getOccupancySummary("property-1", "token-1", { floor: 2, status: "vacant" });

    expect(fetchApi).toHaveBeenCalledWith(
      "/pg-operator/properties/property-1/occupancy?floor=2&status=vacant",
      expect.objectContaining({ headers: { Authorization: "Bearer token-1" } })
    );
  });

  it("sends bed actions to their property-scoped endpoints", () => {
    updateBedStatus("property-1", "bed-1", "blocked", "token-1");
    relistBed("property-1", "bed-1", "token-1");

    expect(fetchApi).toHaveBeenNthCalledWith(
      1,
      "/pg-operator/properties/property-1/beds/bed-1/status",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ Authorization: "Bearer token-1" }),
        body: JSON.stringify({ status: "blocked" })
      })
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      2,
      "/pg-operator/properties/property-1/beds/bed-1/relist",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer token-1" }
      })
    );
  });

  it("gets the managed property before rendering an operations route", () => {
    getManagedProperty("property-1", "token-1");

    expect(fetchApi).toHaveBeenCalledWith(
      "/pg-operator/properties/property-1",
      expect.objectContaining({ headers: { Authorization: "Bearer token-1" } })
    );
  });

  it("sends assignment reads and actions to property-scoped endpoints", () => {
    listAssignments("property-1", "token-1", { status: "active" });
    reserveBed(
      "property-1",
      "bed-1",
      { occupant_name: "A", occupant_phone_e164: "+919999999902" },
      "token-1",
      "idem-1"
    );
    moveInBed(
      "property-1",
      "bed-1",
      { occupant_name: "A", occupant_phone_e164: "+919999999902" },
      "token-1",
      "idem-2"
    );
    operatorMoveOutRequest("property-1", "assignment-1", "token-1");
    confirmAssignmentMoveOut("property-1", "assignment-1", "token-1");
    moveOutAssignmentNow("property-1", "assignment-1", "token-1");
    getOperatorBedDetail("property-1", "bed-1", "token-1");

    expect(fetchApi).toHaveBeenNthCalledWith(
      1,
      "/pg-operator/properties/property-1/assignments?status=active",
      expect.objectContaining({ headers: { Authorization: "Bearer token-1" } })
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      2,
      "/pg-operator/properties/property-1/beds/bed-1/reserve",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Idempotency-Key": "idem-1" })
      })
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      3,
      "/pg-operator/properties/property-1/beds/bed-1/move-in",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Idempotency-Key": "idem-2" })
      })
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      4,
      "/pg-operator/properties/property-1/assignments/assignment-1/operator-move-out-request",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      5,
      "/pg-operator/properties/property-1/assignments/assignment-1/confirm-move-out",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      6,
      "/pg-operator/properties/property-1/assignments/assignment-1/move-out-now",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      7,
      "/pg-operator/properties/property-1/beds/bed-1",
      expect.objectContaining({ headers: { Authorization: "Bearer token-1" } })
    );
  });

  it("sends tenant residence reads and actions to tenant-scoped endpoints", () => {
    getTenantResidence("token-1");
    serveTenantNotice("token-1", { notice_end_date: "2099-02-15" });
    requestTenantMoveOut("token-1");
    acceptTenantOperatorMoveOut("assignment-1", "token-1");
    rejectTenantOperatorMoveOut("assignment-1", "token-1");

    expect(fetchApi).toHaveBeenNthCalledWith(
      1,
      "/tenant/pg-residence",
      expect.objectContaining({ headers: { Authorization: "Bearer token-1" } }),
      { server: true }
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      2,
      "/tenant/pg-residence/notice",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer token-1" }),
        body: JSON.stringify({ notice_end_date: "2099-02-15" })
      })
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      3,
      "/tenant/pg-residence/move-out-request",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      4,
      "/tenant/pg-residence/operator-move-out/assignment-1/accept",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      5,
      "/tenant/pg-residence/operator-move-out/assignment-1/reject",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("sends maintenance reads and mutations to their scoped endpoints", () => {
    fetchApi.mockResolvedValue({ uploads: [] });

    listPropertyMaintenance("property-1", "token-1", { status: "open" });
    listBedMaintenance("property-1", "bed-1", "token-1");
    updateMaintenanceStatus("property-1", "ticket-1", "in_progress", "token-1");
    addMaintenanceComment("property-1", "ticket-1", { body: "On the way" }, "token-1", "idem-1");
    listResidenceMaintenance("token-1");
    createResidenceMaintenance(
      { category: "Plumbing", description: "The tap has been leaking since this morning." },
      "token-1",
      "idem-2"
    );
    addResidenceMaintenanceComment("ticket-1", { body: "Thank you" }, "token-1", "idem-3");
    presignResidenceMaintenancePhotos(
      "ticket-1",
      [{ clientUploadId: "photo-1", contentType: "image/jpeg", sizeBytes: 1200 }],
      "token-1",
      "idem-4"
    );
    completeResidenceMaintenancePhotos(
      "ticket-1",
      [{ clientUploadId: "photo-1", blobPath: "pg-maintenance/property-1/ticket-1/photo-1.jpg" }],
      "token-1",
      "idem-5"
    );
    presignMaintenancePhotos(
      "property-1",
      "ticket-1",
      [{ clientUploadId: "photo-2", contentType: "image/png", sizeBytes: 900 }],
      "token-1",
      "idem-6"
    );
    completeMaintenancePhotos(
      "property-1",
      "ticket-1",
      [{ clientUploadId: "photo-2", blobPath: "pg-maintenance/property-1/ticket-1/photo-2.png" }],
      "token-1",
      "idem-7"
    );

    expect(fetchApi).toHaveBeenNthCalledWith(
      1,
      "/pg-operator/properties/property-1/maintenance?status=open",
      expect.objectContaining({ headers: { Authorization: "Bearer token-1" } })
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      2,
      "/pg-operator/properties/property-1/beds/bed-1/maintenance",
      expect.objectContaining({ headers: { Authorization: "Bearer token-1" } })
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      3,
      "/pg-operator/properties/property-1/maintenance/ticket-1",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ Authorization: "Bearer token-1" }),
        body: JSON.stringify({ status: "in_progress" })
      })
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      4,
      "/pg-operator/properties/property-1/maintenance/ticket-1/comments",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Idempotency-Key": "idem-1" }),
        body: JSON.stringify({ body: "On the way" })
      })
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      5,
      "/tenant/pg-residence/maintenance",
      expect.objectContaining({ headers: { Authorization: "Bearer token-1" } })
    );
    listResidenceMaintenance("token-1", "all");
    expect(fetchApi).toHaveBeenLastCalledWith(
      "/tenant/pg-residence/maintenance?scope=all",
      expect.objectContaining({ headers: { Authorization: "Bearer token-1" } })
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      6,
      "/tenant/pg-residence/maintenance",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Idempotency-Key": "idem-2" }),
        body: JSON.stringify({
          category: "Plumbing",
          description: "The tap has been leaking since this morning."
        })
      })
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      7,
      "/tenant/pg-residence/maintenance/ticket-1/comments",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Idempotency-Key": "idem-3" }),
        body: JSON.stringify({ body: "Thank you" })
      })
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      8,
      "/tenant/pg-residence/maintenance/ticket-1/photos/presign",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Idempotency-Key": "idem-4" }),
        body: JSON.stringify({
          files: [{ client_upload_id: "photo-1", content_type: "image/jpeg", size_bytes: 1200 }]
        })
      })
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      9,
      "/tenant/pg-residence/maintenance/ticket-1/photos/complete",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Idempotency-Key": "idem-5" }),
        body: JSON.stringify({
          photos: [
            {
              client_upload_id: "photo-1",
              blob_path: "pg-maintenance/property-1/ticket-1/photo-1.jpg"
            }
          ]
        })
      })
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      10,
      "/pg-operator/properties/property-1/maintenance/ticket-1/photos/presign",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Idempotency-Key": "idem-6" }),
        body: JSON.stringify({
          files: [{ client_upload_id: "photo-2", content_type: "image/png", size_bytes: 900 }]
        })
      })
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      11,
      "/pg-operator/properties/property-1/maintenance/ticket-1/photos/complete",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Idempotency-Key": "idem-7" }),
        body: JSON.stringify({
          photos: [
            {
              client_upload_id: "photo-2",
              blob_path: "pg-maintenance/property-1/ticket-1/photo-2.png"
            }
          ]
        })
      })
    );
  });

  it("returns the maintenance queue page and serializes cursor filters", async () => {
    fetchApi.mockResolvedValueOnce({ rows: [], next_cursor: "cursor-2" });

    const page = await listPropertyMaintenance("property-1", "token-1", {
      priority: "high",
      sla_state: "overdue",
      floor: 0,
      chargeable_damage: false,
      include_closed: false,
      sort: "sla_due",
      limit: 50,
      cursor: "cursor-1"
    });

    expect(page).toEqual({ rows: [], next_cursor: "cursor-2" });
    expect(fetchApi).toHaveBeenCalledWith(
      "/pg-operator/properties/property-1/maintenance?priority=high&sla_state=overdue&floor=0&chargeable_damage=false&include_closed=false&sort=sla_due&limit=50&cursor=cursor-1",
      expect.objectContaining({ headers: { Authorization: "Bearer token-1" } })
    );
  });

  it("defines the maintenance V2 client contract", () => {
    fetchMaintenanceCategories("token-1");
    getMaintenanceTicket("property-1", "ticket-1", "token-1");
    fetchMaintenanceTimeline("property-1", "ticket-1", "token-1");
    listPropertyMaintenance("property-1", "token-1", {
      status: "open",
      priority: "high",
      sla_state: "overdue",
      category_slug: "plumbing",
      location_kind: "common_area",
      common_area: "lift",
      floor: 3,
      room_id: "room-4",
      bed_id: "bed-5",
      tenant_query: "Ravi",
      chargeable_damage: true,
      include_closed: false,
      date_from: "2026-07-01",
      date_to: "2026-07-14",
      view: "kanban",
      sort: "newest",
      limit: 25,
      cursor: "ticket-2"
    });
    overrideMaintenancePriority(
      "property-1",
      "ticket-1",
      { priority: "emergency", reason: "Water entering electrical panel" },
      "token-1",
      "idem-priority"
    );
    resolveMaintenanceTicket(
      "property-1",
      "ticket-1",
      { note: "Fixed tap", chargeable_damage: false, cost_paise: null },
      "token-1",
      "idem-1"
    );
    addMaintenanceInternalNote(
      "property-1",
      "ticket-1",
      { body: "Call plumber again if this repeats." },
      "token-1",
      "idem-2"
    );
    getResidenceMaintenanceTicket("ticket-1", "token-1");
    reopenResidenceMaintenance("ticket-1", { body: "Still leaking." }, "token-1", "idem-3");
    fetchMaintenanceAnalytics("property-1", "token-1");

    expect(fetchApi).toHaveBeenNthCalledWith(
      1,
      "/pg-operator/maintenance/categories",
      expect.objectContaining({ headers: { Authorization: "Bearer token-1" } })
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      2,
      "/pg-operator/properties/property-1/maintenance/ticket-1",
      expect.objectContaining({ headers: { Authorization: "Bearer token-1" } })
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      3,
      "/pg-operator/properties/property-1/maintenance/ticket-1/timeline",
      expect.objectContaining({ headers: { Authorization: "Bearer token-1" } })
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      4,
      "/pg-operator/properties/property-1/maintenance?status=open&priority=high&sla_state=overdue&category_slug=plumbing&location_kind=common_area&common_area=lift&floor=3&room_id=room-4&bed_id=bed-5&tenant_query=Ravi&chargeable_damage=true&include_closed=false&date_from=2026-07-01&date_to=2026-07-14&view=kanban&sort=newest&limit=25&cursor=ticket-2",
      expect.objectContaining({ headers: { Authorization: "Bearer token-1" } })
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      5,
      "/pg-operator/properties/property-1/maintenance/ticket-1/priority",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Idempotency-Key": "idem-priority" }),
        body: JSON.stringify({
          priority: "emergency",
          reason: "Water entering electrical panel"
        })
      })
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      6,
      "/pg-operator/properties/property-1/maintenance/ticket-1/resolve",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Idempotency-Key": "idem-1" }),
        body: JSON.stringify({ note: "Fixed tap", chargeable_damage: false, cost_paise: null })
      })
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      7,
      "/pg-operator/properties/property-1/maintenance/ticket-1/internal-notes",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Idempotency-Key": "idem-2" }),
        body: JSON.stringify({ body: "Call plumber again if this repeats." })
      })
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      8,
      "/tenant/pg-residence/maintenance/ticket-1",
      expect.objectContaining({ headers: { Authorization: "Bearer token-1" } })
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      9,
      "/tenant/pg-residence/maintenance/ticket-1/reopen",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Idempotency-Key": "idem-3" }),
        body: JSON.stringify({ body: "Still leaking." })
      })
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      10,
      "/pg-operator/properties/property-1/maintenance/analytics",
      expect.objectContaining({ headers: { Authorization: "Bearer token-1" } })
    );
  });
});
