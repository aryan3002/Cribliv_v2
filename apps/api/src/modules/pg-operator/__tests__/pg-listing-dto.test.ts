import { describe, expect, it } from "vitest";
import { PgListingCreateSchema } from "../dto/pg-listing.dto";

const base = {
  property: { display_name: "X", city_slug: "lucknow" },
  pg_details: { total_beds: 4 },
  room_types: [{ sharing: "double", ac: true, monthly_rent_paise: 800_000, vacancy_count: 2 }]
};

describe("PgListingCreateSchema", () => {
  it("accepts description + room has_balcony + per-room deposit", () => {
    const result = PgListingCreateSchema.safeParse({
      ...base,
      description: "A calm PG near the metro.",
      room_types: [{ ...base.room_types[0], has_balcony: true, security_deposit_paise: 1_600_000 }]
    });

    expect(result.success).toBe(true);
  });

  it("rejects an over-long description", () => {
    const result = PgListingCreateSchema.safeParse({ ...base, description: "x".repeat(2001) });

    expect(result.success).toBe(false);
  });
});
