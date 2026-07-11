import { describe, it, expect, vi } from "vitest";
import { PgListingService } from "../src/modules/pg-operator/services/pg-listing.service";

const id = "1".repeat(32);

function svc(headRow: Record<string, unknown>) {
  const db = {
    isEnabled: () => true,
    query: vi.fn(async (sql: string) =>
      /FROM pg_listings pl/i.test(sql)
        ? { rows: [headRow], rowCount: 1 }
        : { rows: [], rowCount: 0 }
    )
  };
  return new PgListingService(db as never, {} as never, {} as never);
}

const head = {
  id,
  status: "active",
  title: "PG",
  starting_rent_paise: 900000,
  created_at: null,
  city_slug: "lucknow",
  locality_slug: "gomti-nagar",
  total_beds: 10,
  gender_policy: "coed",
  tenant_type: null,
  security_deposit_paise: 0,
  notice_period_days: 30,
  lock_in_months: 0,
  electricity_mode: null,
  rent_due_day: 1,
  price_negotiable: false,
  payment_modes: [],
  meals: null,
  amenities: {},
  house_rules: {},
  verification_status: "verified",
  has_exact_geo: true,
  composite_score: 50,
  ll_lat: 26.8551,
  ll_lng: 80.941,
  loc_lat: 26.8467,
  loc_lng: 80.9462,
  city_name: "Lucknow",
  locality_name: "Gomti Nagar"
};

describe("PG detail location_point", () => {
  it("distinct coord -> exact point", async () => {
    const d = await (svc(head) as any).loadListingDetail(id, "pl.id = $1::uuid", [id]);
    expect(d.location_point).toMatchObject({ source: "exact", lat: 26.8551, lng: 80.941 });
  });

  it("coord == locality centroid -> locality point", async () => {
    const d = await (svc({ ...head, ll_lat: 26.8467, ll_lng: 80.9462 }) as any).loadListingDetail(
      id,
      "pl.id = $1::uuid",
      [id]
    );
    expect(d.location_point.source).toBe("locality");
  });

  it("no coord -> null point", async () => {
    const d = await (svc({ ...head, ll_lat: null, ll_lng: null }) as any).loadListingDetail(
      id,
      "pl.id = $1::uuid",
      [id]
    );
    expect(d.location_point).toBeNull();
  });
});
