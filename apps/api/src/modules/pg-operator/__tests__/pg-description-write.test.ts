import { describe, expect, it, vi } from "vitest";
import { AppStateService } from "../../../common/app-state.service";
import { PgListingService } from "../services/pg-listing.service";

describe("PgListingService description projection", () => {
  it("persists a trimmed description to listings.description_en", async () => {
    const client = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (/INSERT INTO listings/i.test(sql)) {
          return { rows: [{ id: "listing-1", status: "draft" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn()
    };
    const database = {
      isEnabled: () => true,
      getClient: vi.fn(async () => client),
      query: vi.fn(async (sql: string) =>
        /phone_e164/i.test(sql)
          ? { rows: [{ phone_e164: "+919999999999", whatsapp_opt_in: true }], rowCount: 1 }
          : { rows: [], rowCount: 0 }
      )
    } as any;
    const properties = {
      getOwnedProperty: vi.fn(async () => ({
        id: "prop-1",
        operator_id: "op-1",
        city_id: 1,
        locality_id: null,
        lat: null,
        lng: null,
        is_primary: true
      }))
    };
    const service = new PgListingService(database, new AppStateService(), properties as any);

    await service.createDraft("op-1", "prop-1", {
      description: "  Quiet, verified PG near Gomti Nagar metro.  ",
      property: { display_name: "Verify PG", city_slug: "lucknow" },
      pg_details: { total_beds: 6 },
      room_types: [{ sharing: "double", ac: true, monthly_rent_paise: 900_000, vacancy_count: 3 }]
    });

    const projection = client.query.mock.calls.find(([sql]) => /INSERT INTO listings/i.test(sql));

    expect(projection?.[0]).toContain("description_en");
    expect(projection?.[1]).toContain("Quiet, verified PG near Gomti Nagar metro.");
  });
});
