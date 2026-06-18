import { describe, it, expect } from "vitest";
import { isMaterialChange } from "../services/pg-listing-material";
import type { PgListingPayload } from "@cribliv/shared-types";

// A fully-populated "before" payload. Each test mutates one field off this base.
const base: PgListingPayload = {
  title: "Sunrise PG — Boys",
  property: {
    display_name: "Sunrise PG",
    internal_code: "SUN-01",
    city_slug: "pune",
    locality_slug: "kothrud",
    total_floors: 3,
    lat: 18.51,
    lng: 73.81,
    formatted_address: "12, Some Rd, Kothrud, Pune"
  },
  pg_details: {
    total_beds: 12,
    gender_policy: "boys",
    tenant_type: "students",
    security_deposit_paise: 5000000,
    deposit_refundable_pct: 80,
    price_negotiable: false,
    meals: { provided: true, veg_only: true },
    meal_charges_paise: 300000,
    amenities: { core: ["wifi", "cctv"], room: ["ac"] },
    house_rules: {
      smoking: false,
      alcohol: false,
      non_veg: true,
      pets: false,
      cooking_in_room: false
    },
    nearby: { metro: ["Vanaz"] },
    late_fee_policy: { per_day_paise: 5000 },
    notice_period_days: 30,
    lock_in_months: 2,
    electricity_mode: "submetered",
    maintenance_paise: 150000,
    rent_due_day: 5,
    payment_modes: ["upi", "bank_transfer"]
  },
  room_types: [
    {
      sharing: "double",
      ac: true,
      bathroom_kind: "attached_western",
      furnishing: "semi_furnished",
      monthly_rent_paise: 900000,
      vacancy_count: 4,
      available_from: "2026-07-01"
    },
    {
      sharing: "triple",
      ac: false,
      bathroom_kind: "shared_indian",
      furnishing: "unfurnished",
      monthly_rent_paise: 700000,
      vacancy_count: 6,
      available_from: null
    }
  ]
};

// deep clone so mutating a test copy never bleeds into `base`
const clone = (p: PgListingPayload): PgListingPayload => JSON.parse(JSON.stringify(p));

describe("isMaterialChange", () => {
  it("identical payloads → false (no re-review)", () => {
    expect(isMaterialChange(base, clone(base))).toBe(false);
  });

  it("title is null vs empty string → false (normalized)", () => {
    const b = clone(base);
    const n = clone(base);
    b.title = null;
    n.title = "";
    expect(isMaterialChange(b, n)).toBe(false);
  });

  describe("MATERIAL fields → true", () => {
    it("title change", () => {
      const n = clone(base);
      n.title = "FREE PG CALL 99999";
      expect(isMaterialChange(base, n)).toBe(true);
    });
    it("property display_name", () => {
      const n = clone(base);
      n.property.display_name = "Moonlight PG";
      expect(isMaterialChange(base, n)).toBe(true);
    });
    it("property city_slug", () => {
      const n = clone(base);
      n.property.city_slug = "mumbai";
      expect(isMaterialChange(base, n)).toBe(true);
    });
    it("property locality_slug", () => {
      const n = clone(base);
      n.property.locality_slug = "baner";
      expect(isMaterialChange(base, n)).toBe(true);
    });
    it("property lat/lng", () => {
      const n = clone(base);
      n.property.lat = 19.0;
      expect(isMaterialChange(base, n)).toBe(true);
    });
    it("total_beds", () => {
      const n = clone(base);
      n.pg_details.total_beds = 20;
      expect(isMaterialChange(base, n)).toBe(true);
    });
    it("gender_policy (kept material — safety)", () => {
      const n = clone(base);
      n.pg_details.gender_policy = "coed";
      expect(isMaterialChange(base, n)).toBe(true);
    });
    it("tenant_type", () => {
      const n = clone(base);
      n.pg_details.tenant_type = "working";
      expect(isMaterialChange(base, n)).toBe(true);
    });
    it("amenities (kept material — false-advertising)", () => {
      const n = clone(base);
      n.pg_details.amenities = { core: ["wifi", "cctv", "power_backup"], room: ["ac"] };
      expect(isMaterialChange(base, n)).toBe(true);
    });
    it("security_deposit_paise (kept material — financial)", () => {
      const n = clone(base);
      n.pg_details.security_deposit_paise = 50000000;
      expect(isMaterialChange(base, n)).toBe(true);
    });
    it("deposit_refundable_pct", () => {
      const n = clone(base);
      n.pg_details.deposit_refundable_pct = 0;
      expect(isMaterialChange(base, n)).toBe(true);
    });
    it("payment terms — notice_period_days", () => {
      const n = clone(base);
      n.pg_details.notice_period_days = 60;
      expect(isMaterialChange(base, n)).toBe(true);
    });
    it("nearby", () => {
      const n = clone(base);
      n.pg_details.nearby = { metro: ["Vanaz", "Anand Nagar"] };
      expect(isMaterialChange(base, n)).toBe(true);
    });
    it("room rent change", () => {
      const n = clone(base);
      n.room_types[0].monthly_rent_paise = 1200000;
      expect(isMaterialChange(base, n)).toBe(true);
    });
    it("room vacancy change", () => {
      const n = clone(base);
      n.room_types[0].vacancy_count = 1;
      expect(isMaterialChange(base, n)).toBe(true);
    });
    it("room added", () => {
      const n = clone(base);
      n.room_types.push({
        sharing: "single",
        ac: true,
        bathroom_kind: "attached_western",
        furnishing: "fully_furnished",
        monthly_rent_paise: 1500000,
        vacancy_count: 2,
        available_from: null
      });
      expect(isMaterialChange(base, n)).toBe(true);
    });
    it("room removed", () => {
      const n = clone(base);
      n.room_types.pop();
      expect(isMaterialChange(base, n)).toBe(true);
    });
  });

  describe("NON-material fields → false (stay live)", () => {
    it("internal_code", () => {
      const n = clone(base);
      n.property.internal_code = "SUN-02";
      expect(isMaterialChange(base, n)).toBe(false);
    });
    it("total_floors", () => {
      const n = clone(base);
      n.property.total_floors = 9;
      expect(isMaterialChange(base, n)).toBe(false);
    });
    it("formatted_address", () => {
      const n = clone(base);
      n.property.formatted_address = "New formatted address";
      expect(isMaterialChange(base, n)).toBe(false);
    });
    it("price_negotiable", () => {
      const n = clone(base);
      n.pg_details.price_negotiable = true;
      expect(isMaterialChange(base, n)).toBe(false);
    });
    it("late_fee_policy", () => {
      const n = clone(base);
      n.pg_details.late_fee_policy = { per_day_paise: 99999 };
      expect(isMaterialChange(base, n)).toBe(false);
    });
    it("meals (moved non-material per owner)", () => {
      const n = clone(base);
      n.pg_details.meals = { provided: false };
      expect(isMaterialChange(base, n)).toBe(false);
    });
    it("meal_charges_paise (moved non-material per owner)", () => {
      const n = clone(base);
      n.pg_details.meal_charges_paise = 999999;
      expect(isMaterialChange(base, n)).toBe(false);
    });
    it("house_rules (moved non-material per owner)", () => {
      const n = clone(base);
      n.pg_details.house_rules = { ...base.pg_details.house_rules!, smoking: true, pets: true };
      expect(isMaterialChange(base, n)).toBe(false);
    });
  });

  describe("order-insensitive (no phantom diffs)", () => {
    it("room_types reordered (same set) → false", () => {
      const n = clone(base);
      n.room_types.reverse();
      expect(isMaterialChange(base, n)).toBe(false);
    });
    it("payment_modes reordered → false", () => {
      const n = clone(base);
      n.pg_details.payment_modes = ["bank_transfer", "upi"];
      expect(isMaterialChange(base, n)).toBe(false);
    });
    it("absent vs empty payment_modes → false", () => {
      const b = clone(base);
      const n = clone(base);
      delete b.pg_details.payment_modes;
      n.pg_details.payment_modes = [];
      expect(isMaterialChange(b, n)).toBe(false);
    });
  });
});
