import { describe, it, expect } from "vitest";
import { PgPropertyCreateSchema } from "../src/modules/pg-operator/dto/pg-property.dto";

describe("PgPropertyCreateSchema geo", () => {
  it("accepts valid lat/lng/formatted_address", () => {
    const r = PgPropertyCreateSchema.safeParse({
      display_name: "Sunrise PG",
      city_slug: "lucknow",
      lat: 26.8467,
      lng: 80.9462,
      formatted_address: "Gomti Nagar, Lucknow"
    });
    expect(r.success).toBe(true);
  });
  it("rejects out-of-range lat", () => {
    const r = PgPropertyCreateSchema.safeParse({
      display_name: "Sunrise PG",
      city_slug: "lucknow",
      lat: 99,
      lng: 80
    });
    expect(r.success).toBe(false);
  });
  it("allows missing geo (optional)", () => {
    const r = PgPropertyCreateSchema.safeParse({
      display_name: "Sunrise PG",
      city_slug: "lucknow"
    });
    expect(r.success).toBe(true);
  });
});
