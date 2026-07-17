import { describe, expect, it, vi } from "vitest";
import { AppStateService } from "../../../common/app-state.service";
import { PgListingService } from "../services/pg-listing.service";

function makeService() {
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

  return {
    client,
    service: new PgListingService(database, new AppStateService(), properties as any)
  };
}

describe("PgListingService room-type writes", () => {
  it("persists per-room balcony and security deposit", async () => {
    const { client, service } = makeService();

    await service.createDraft("op-1", "prop-1", {
      property: { display_name: "Verify PG", city_slug: "lucknow", lat: 26.8467, lng: 80.9462 },
      pg_details: { total_beds: 6 },
      room_types: [
        {
          sharing: "double",
          ac: true,
          has_balcony: true,
          monthly_rent_paise: 900_000,
          vacancy_count: 3,
          security_deposit_paise: 1_800_000
        }
      ]
    });

    const roomInsert = client.query.mock.calls.find(([sql]) =>
      /INSERT INTO pg_room_types/i.test(sql)
    );

    expect(roomInsert?.[0]).toContain("has_balcony");
    expect(roomInsert?.[0]).toContain("security_deposit_paise");
    expect(roomInsert?.[1]).toEqual(expect.arrayContaining([true, 900_000, 3, 1_800_000]));
  });
});
