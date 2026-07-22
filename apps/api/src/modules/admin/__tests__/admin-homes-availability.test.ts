import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppStateService } from "../../../common/app-state.service";
import { AvailabilityAlertsService } from "../../availability-alerts/availability-alerts.service";
import { AdminHomesService } from "../admin-homes.service";

const now = Date.now();

function installFixtures(appState: AppStateService) {
  (appState as any).users = new Map([
    [
      "owner-1",
      {
        id: "owner-1",
        phone: "+919999999901",
        role: "owner",
        preferred_language: "en",
        full_name: "Ramesh Kumar"
      }
    ]
  ]);
  (appState as any).listings = new Map([
    [
      "active-home",
      {
        id: "active-home",
        ownerUserId: "owner-1",
        listingType: "flat_house",
        title: "Gomti View Residence",
        city: "lucknow",
        locality: "gomti-nagar",
        monthlyRent: 20000,
        verificationStatus: "verified",
        status: "active",
        createdAt: now - 1_000,
        updatedAt: now - 1_000
      }
    ],
    [
      "pg-home",
      {
        id: "pg-home",
        ownerUserId: "owner-1",
        listingType: "pg",
        title: "Verified PG",
        city: "lucknow",
        monthlyRent: 8000,
        verificationStatus: "verified",
        status: "active",
        createdAt: now
      }
    ]
  ]);
  (appState as any).leads = new Map();
}

describe("AdminHomesService — availability toggle + waitlist leads", () => {
  let database: { isEnabled: () => boolean; query: ReturnType<typeof vi.fn> };
  let appState: AppStateService;
  let availabilityAlerts: AvailabilityAlertsService;
  let service: AdminHomesService;

  beforeEach(() => {
    database = { isEnabled: () => false, query: vi.fn() };
    appState = new AppStateService();
    installFixtures(appState);
    availabilityAlerts = new AvailabilityAlertsService(appState, database as any);
    service = new AdminHomesService(database as any, appState, availabilityAlerts);
  });

  it("admin marks unavailable and lists waitlist leads with phone", async () => {
    const l = [...appState.listings.values()].find(
      (x: any) => x.status === "active" && x.listingType === "flat_house"
    )! as any;
    appState.addAvailabilityAlert({
      listing_id: l.id,
      phone: "+919000000009",
      user_id: null,
      locale: "en"
    });

    const result = await service.setAvailability(l.id, false, "admin-1");

    expect(result).toEqual({ listing_id: l.id, is_available: false });
    expect((appState.listings.get(l.id) as any).is_available).toBe(false);

    const leads = await service.listWaitlist(l.id);
    expect(leads[0].phone).toBe("+919000000009");
  });

  it("records an admin_actions audit entry with action availability_change", async () => {
    const l = appState.listings.get("active-home")!;
    await service.setAvailability(l.id, false, "admin-1", "went off-market");

    const action = (appState as any).adminActions.find(
      (a: any) => a.target_id === l.id && a.action === "availability_change"
    );
    expect(action).toBeDefined();
    expect(action.admin_id ?? action.admin_user_id).toBe("admin-1");
    expect(action.reason).toBe("went off-market");
  });

  it("flips waiting alerts to ready when availability is restored", async () => {
    const l = appState.listings.get("active-home")!;
    appState.addAvailabilityAlert({
      listing_id: l.id,
      phone: "+919000000009",
      user_id: null,
      locale: "en"
    });
    await service.setAvailability(l.id, false, "admin-1");

    await service.setAvailability(l.id, true, "admin-1");

    const leads = await service.listWaitlist(l.id);
    expect(leads[0].status).toBe("ready");
  });

  it("rejects availability changes for non-flat_house listings", async () => {
    await expect(service.setAvailability("pg-home", false, "admin-1")).rejects.toBeTruthy();
  });

  it("does not require owner scoping — any admin can flip any listing", async () => {
    const result = await service.setAvailability("active-home", false, "admin-999");
    expect(result.is_available).toBe(false);
  });
});
