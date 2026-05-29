import { describe, it, expect, vi } from "vitest";
import { PgListingService } from "../services/pg-listing.service";
import { AppStateService } from "../../../common/app-state.service";

function makeDeps() {
  const ownerService = {
    createListing: vi.fn(async (_op: string, dto: Record<string, unknown>) => ({
      id: "listing-1",
      status: "draft",
      ...dto
    }))
  };
  const pgPropertiesService = {
    getActiveProperty: vi.fn(async () => ({
      id: "prop-1",
      operator_id: "op-1",
      city_slug: "delhi",
      display_name: "A",
      is_primary: true,
      locality_slug: null,
      internal_code: null,
      status: "active" as const,
      total_floors: null,
      metadata: {},
      created_at: "",
      updated_at: ""
    }))
  };
  const db = { isEnabled: () => false, query: vi.fn() } as any;
  const appState = new AppStateService();
  return { ownerService, pgPropertiesService, db, appState };
}

describe("PgListingService", () => {
  describe("createDraft()", () => {
    it("composes owner.createListing + writes pg_details with listing_type=pg", async () => {
      const { ownerService, pgPropertiesService, db, appState } = makeDeps();
      const svc = new PgListingService(
        db,
        appState,
        ownerService as any,
        pgPropertiesService as any
      );
      const result = await svc.createDraft("op-1", "prop-1", {
        property: { display_name: "A", city_slug: "delhi" },
        pg_details: { total_beds: 10 } as any,
        room_types: [
          {
            sharing: "double",
            ac: true,
            bathroom_kind: "attached_western",
            furnishing: "semi_furnished",
            monthly_rent_paise: 1200000,
            vacancy_count: 4
          }
        ]
      });
      expect(result.id).toBe("listing-1");
      expect(ownerService.createListing).toHaveBeenCalledOnce();
      const dto = ownerService.createListing.mock.calls[0][1] as any;
      expect(dto.listing_type).toBe("pg");
      expect(dto.pg_property_id).toBe("prop-1");
    });

    it("throws no_room_types when room_types empty", async () => {
      const { ownerService, pgPropertiesService, db, appState } = makeDeps();
      const svc = new PgListingService(
        db,
        appState,
        ownerService as any,
        pgPropertiesService as any
      );
      await expect(
        svc.createDraft("op-1", "prop-1", {
          property: { display_name: "A", city_slug: "delhi" },
          pg_details: { total_beds: 10 } as any,
          room_types: []
        })
      ).rejects.toThrow(/no_room_types/i);
    });

    it("throws property_not_found when active property id mismatches", async () => {
      const { ownerService, pgPropertiesService, db, appState } = makeDeps();
      const svc = new PgListingService(
        db,
        appState,
        ownerService as any,
        pgPropertiesService as any
      );
      await expect(
        svc.createDraft("op-1", "wrong-prop", {
          property: { display_name: "A", city_slug: "delhi" },
          pg_details: { total_beds: 10 } as any,
          room_types: [
            { sharing: "single", ac: false, monthly_rent_paise: 500000, vacancy_count: 1 }
          ] as any
        })
      ).rejects.toThrow(/property_not_found/i);
    });
  });

  describe("hydrateFromVoiceDraft()", () => {
    it("is idempotent on the same idempotency key", async () => {
      const { ownerService, pgPropertiesService, db, appState } = makeDeps();
      const svc = new PgListingService(
        db,
        appState,
        ownerService as any,
        pgPropertiesService as any
      );
      appState.insertPgListingDraft({
        id: "draft-1",
        operator_user_id: "op-1",
        pg_property_id: "prop-1",
        payload: {
          property: { display_name: "A", city_slug: "delhi" },
          pg_details: { total_beds: 10 },
          room_types: [
            { sharing: "single", ac: false, monthly_rent_paise: 500000, vacancy_count: 1 }
          ]
        }
      });
      const a = await svc.hydrateFromVoiceDraft("draft-1", { idempotencyKey: "pg_voice:s1" });
      const b = await svc.hydrateFromVoiceDraft("draft-1", { idempotencyKey: "pg_voice:s1" });
      expect(a.id).toBe(b.id);
      expect(ownerService.createListing).toHaveBeenCalledOnce();
    });

    it("throws draft_not_found for unknown draft id", async () => {
      const { ownerService, pgPropertiesService, db, appState } = makeDeps();
      const svc = new PgListingService(
        db,
        appState,
        ownerService as any,
        pgPropertiesService as any
      );
      await expect(
        svc.hydrateFromVoiceDraft("nope", { idempotencyKey: "pg_voice:x" })
      ).rejects.toThrow(/draft_not_found/i);
    });
  });
});
