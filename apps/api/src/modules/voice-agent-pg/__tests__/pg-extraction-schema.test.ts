import { describe, it, expect } from "vitest";
import {
  PropertyBasicsSchema,
  RoomConfigSchema,
  PricingMatrixSchema,
  PaymentTermsSchema,
  AmenitiesSchema,
  FoodSchema,
  HouseRulesSchema
} from "../schema/pg-extraction-schema";

describe("pg-extraction-schema", () => {
  describe("PropertyBasicsSchema", () => {
    it("accepts minimal valid input", () => {
      expect(PropertyBasicsSchema.safeParse({ display_name: "Hostel A" }).success).toBe(true);
    });
    it("rejects empty display_name", () => {
      expect(PropertyBasicsSchema.safeParse({ display_name: "" }).success).toBe(false);
    });
    it("accepts null total_floors (strict null)", () => {
      expect(
        PropertyBasicsSchema.safeParse({ display_name: "A", total_floors: null }).success
      ).toBe(true);
    });
  });

  describe("PricingMatrixSchema", () => {
    it("rejects rent below ₹2k", () => {
      expect(
        PricingMatrixSchema.safeParse({
          sharing: "double",
          ac: true,
          monthly_rent_paise: 100_000,
          vacancy_count: 1
        }).success
      ).toBe(false);
    });
    it("rejects rent above ₹50k", () => {
      expect(
        PricingMatrixSchema.safeParse({
          sharing: "double",
          ac: true,
          monthly_rent_paise: 6_000_000,
          vacancy_count: 1
        }).success
      ).toBe(false);
    });
    it("accepts boundary rent ₹2k and ₹50k", () => {
      expect(
        PricingMatrixSchema.safeParse({
          sharing: "double",
          ac: true,
          monthly_rent_paise: 200_000,
          vacancy_count: 1
        }).success
      ).toBe(true);
      expect(
        PricingMatrixSchema.safeParse({
          sharing: "double",
          ac: true,
          monthly_rent_paise: 5_000_000,
          vacancy_count: 1
        }).success
      ).toBe(true);
    });
    it("rejects negative vacancy", () => {
      expect(
        PricingMatrixSchema.safeParse({
          sharing: "single",
          ac: false,
          monthly_rent_paise: 800_000,
          vacancy_count: -1
        }).success
      ).toBe(false);
    });
  });

  describe("RoomConfigSchema", () => {
    it("requires total_beds > 0", () => {
      expect(
        RoomConfigSchema.safeParse({ total_beds: 0, sharing_options: ["single"] }).success
      ).toBe(false);
      expect(
        RoomConfigSchema.safeParse({ total_beds: 5, sharing_options: ["single"] }).success
      ).toBe(true);
    });
    it("rejects unknown sharing kind", () => {
      expect(RoomConfigSchema.safeParse({ total_beds: 5, sharing_options: ["king"] }).success).toBe(
        false
      );
    });
  });

  describe("FoodSchema", () => {
    it("accepts provided=false with all meal flags null", () => {
      expect(FoodSchema.safeParse({ provided: false }).success).toBe(true);
    });
    it("accepts provided=true with explicit per-meal toggles", () => {
      expect(
        FoodSchema.safeParse({
          provided: true,
          breakfast: true,
          lunch: true,
          snack: false,
          dinner: true,
          veg_only: true
        }).success
      ).toBe(true);
    });
  });

  describe("HouseRulesSchema", () => {
    it("accepts nullable curfew + guests_policy (strict null)", () => {
      expect(
        HouseRulesSchema.safeParse({
          smoking: false,
          alcohol: false,
          non_veg: true,
          pets: false,
          cooking_in_room: false
        }).success
      ).toBe(true);
    });
  });

  describe("AmenitiesSchema", () => {
    it("rejects amenity strings outside the allowlist", () => {
      expect(AmenitiesSchema.safeParse({ core: ["jetski"] }).success).toBe(false);
    });
    it("accepts well-known core amenities", () => {
      expect(
        AmenitiesSchema.safeParse({ core: ["wifi", "hot_water", "power_backup"] }).success
      ).toBe(true);
    });
  });

  describe("PaymentTermsSchema", () => {
    it("rejects rent_due_day outside 1..28", () => {
      expect(PaymentTermsSchema.safeParse({ rent_due_day: 0 }).success).toBe(false);
      expect(PaymentTermsSchema.safeParse({ rent_due_day: 29 }).success).toBe(false);
      expect(PaymentTermsSchema.safeParse({ rent_due_day: 5 }).success).toBe(true);
    });
  });
});
