import { describe, it, expect } from "vitest";
import { extractRoomConfigTool } from "../tools/extract-room-config.tool";
import { extractPricingMatrixTool } from "../tools/extract-pricing-matrix.tool";
import { extractPaymentTermsTool } from "../tools/extract-payment-terms.tool";
import { extractAmenitiesTool } from "../tools/extract-amenities.tool";
import { extractFoodTool } from "../tools/extract-food.tool";
import { extractHouseRulesTool } from "../tools/extract-house-rules.tool";

const ctx = { sessionId: "s1", phase: "discovery" as const, locale: "en" as const };

describe("extract_room_config", () => {
  it("valid input → ok with pg_details.total_beds", () => {
    const r = extractRoomConfigTool.handler(
      { total_beds: 24, sharing_options: ["double", "triple"] },
      ctx
    );
    expect(r.ok).toBe(true);
    expect(r.extracted.find((e) => e.field === "pg_details.total_beds")?.value).toBe(24);
  });
  it("rejects total_beds=0", () => {
    expect(
      extractRoomConfigTool.handler({ total_beds: 0, sharing_options: ["double"] }, ctx).ok
    ).toBe(false);
  });
  it("rejects unknown sharing kind", () => {
    const r = extractRoomConfigTool.handler({ total_beds: 10, sharing_options: ["king"] }, ctx);
    expect(r.ok).toBe(false);
    expect(r.errors[0].field).toMatch(/sharing_options/);
  });
  it("strict null: skips null bathroom_kind from extracted", () => {
    const r = extractRoomConfigTool.handler(
      { total_beds: 5, sharing_options: ["single"], bathroom_kind: null },
      ctx
    );
    expect(r.ok).toBe(true);
    expect(r.extracted.find((e) => e.field === "pg_details.bathroom_kind")).toBeUndefined();
  });
});

describe("extract_pricing_matrix", () => {
  it("valid → emits single room_types.cell entry", () => {
    const r = extractPricingMatrixTool.handler(
      { sharing: "double", ac: true, monthly_rent_paise: 1_200_000, vacancy_count: 4 },
      ctx
    );
    expect(r.ok).toBe(true);
    expect(r.extracted[0].field).toBe("room_types.cell");
  });
  it("rejects rent below ₹2k", () => {
    expect(
      extractPricingMatrixTool.handler(
        { sharing: "double", ac: true, monthly_rent_paise: 100_000, vacancy_count: 1 },
        ctx
      ).ok
    ).toBe(false);
  });
  it("accepts boundary rents ₹2k and ₹50k", () => {
    for (const paise of [200_000, 5_000_000]) {
      expect(
        extractPricingMatrixTool.handler(
          { sharing: "single", ac: false, monthly_rent_paise: paise, vacancy_count: 1 },
          ctx
        ).ok
      ).toBe(true);
    }
  });
  it("rejects negative vacancy_count", () => {
    expect(
      extractPricingMatrixTool.handler(
        { sharing: "double", ac: true, monthly_rent_paise: 1_000_000, vacancy_count: -1 },
        ctx
      ).ok
    ).toBe(false);
  });
});

describe("extract_payment_terms", () => {
  it("rejects rent_due_day=0", () => {
    expect(extractPaymentTermsTool.handler({ rent_due_day: 0 }, ctx).ok).toBe(false);
  });
  it("rejects rent_due_day=29", () => {
    expect(extractPaymentTermsTool.handler({ rent_due_day: 29 }, ctx).ok).toBe(false);
  });
  it("accepts rent_due_day=5", () => {
    expect(extractPaymentTermsTool.handler({ rent_due_day: 5 }, ctx).ok).toBe(true);
  });
  it("empty input is valid (all-optional schema)", () => {
    const r = extractPaymentTermsTool.handler({}, ctx);
    expect(r.ok).toBe(true);
    expect(r.extracted).toEqual([]);
  });
});

describe("extract_amenities", () => {
  it("rejects unknown amenity 'jetski'", () => {
    expect(extractAmenitiesTool.handler({ core: ["jetski"] }, ctx).ok).toBe(false);
  });
  it("emits per non-empty bucket", () => {
    const r = extractAmenitiesTool.handler({ core: ["wifi", "power_backup"], room: ["ac"] }, ctx);
    expect(r.ok).toBe(true);
    expect(r.extracted.map((e) => e.field).sort()).toEqual([
      "pg_details.amenities.core",
      "pg_details.amenities.room"
    ]);
  });
});

describe("extract_food", () => {
  it("provided=false is valid; emits single composite", () => {
    const r = extractFoodTool.handler({ provided: false }, ctx);
    expect(r.ok).toBe(true);
    expect(r.extracted.length).toBe(1);
    expect(r.extracted[0].field).toBe("pg_details.meals");
  });
  it("provided=true with per-meal toggles is valid", () => {
    const r = extractFoodTool.handler(
      {
        provided: true,
        breakfast: true,
        lunch: true,
        snack: false,
        dinner: true,
        veg_only: true,
        meal_charges_paise: 200_000
      },
      ctx
    );
    expect(r.ok).toBe(true);
    expect(r.extracted.find((e) => e.field === "pg_details.meal_charges_paise")?.value).toBe(
      200_000
    );
  });
  it("rejects provided='yes' (type)", () => {
    expect(extractFoodTool.handler({ provided: "yes" }, ctx).ok).toBe(false);
  });
});

describe("extract_house_rules", () => {
  it("minimal valid input passes", () => {
    const r = extractHouseRulesTool.handler(
      {
        smoking: false,
        alcohol: false,
        non_veg: true,
        pets: false,
        cooking_in_room: false
      },
      ctx
    );
    expect(r.ok).toBe(true);
  });
  it("rejects curfew_time without colon (regex)", () => {
    const r = extractHouseRulesTool.handler(
      {
        smoking: false,
        alcohol: false,
        non_veg: true,
        pets: false,
        cooking_in_room: false,
        curfew_time: "2300"
      },
      ctx
    );
    expect(r.ok).toBe(false);
  });
  it("hoists gender_policy + tenant_type to top-level pg_details.*", () => {
    const r = extractHouseRulesTool.handler(
      {
        smoking: false,
        alcohol: false,
        non_veg: true,
        pets: false,
        cooking_in_room: false,
        gender_policy: "girls",
        tenant_type: "students"
      },
      ctx
    );
    expect(r.ok).toBe(true);
    expect(r.extracted.find((e) => e.field === "pg_details.gender_policy")?.value).toBe("girls");
    expect(r.extracted.find((e) => e.field === "pg_details.tenant_type")?.value).toBe("students");
  });
});
