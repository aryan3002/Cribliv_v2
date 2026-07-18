import { describe, it, expect } from "vitest";
import { sanitizePartialDraft } from "../pg-wizard-sanitizer";

describe("sanitizePartialDraft", () => {
  // --- Spec cases ---
  it("preserves a non-empty listing description for draft resume", () => {
    const result = sanitizePartialDraft({ description: "  AI generated copy  " } as any);

    expect(result).toMatchObject({ description: "AI generated copy" });
  });

  it("drops empty strings", () => {
    expect(
      sanitizePartialDraft({ property: { display_name: "", city_slug: "blr" } } as any)
    ).toEqual({ property: { city_slug: "blr" } });
  });

  it("drops short display_name (<2 chars)", () => {
    expect(
      sanitizePartialDraft({ property: { display_name: "X", city_slug: "blr" } } as any)
    ).toEqual({ property: { city_slug: "blr" } });
  });

  it("drops negative or non-integer total_beds", () => {
    expect(
      sanitizePartialDraft({ pg_details: { total_beds: -1 } } as any).pg_details?.total_beds
    ).toBeUndefined();
    expect(
      sanitizePartialDraft({ pg_details: { total_beds: 1.5 } } as any).pg_details?.total_beds
    ).toBeUndefined();
  });

  it("keeps valid values", () => {
    expect(
      sanitizePartialDraft({ pg_details: { total_beds: 12, gender_policy: "boys" } } as any)
    ).toEqual({ pg_details: { total_beds: 12, gender_policy: "boys" } });
  });

  it("drops zero-vacancy room_types entries", () => {
    const r = sanitizePartialDraft({
      room_types: [{ sharing: "double", ac: true, monthly_rent_paise: 0, vacancy_count: 0 }]
    } as any);
    expect(r.room_types).toBeUndefined();
  });

  // --- Strengthening cases ---
  it("empty input → empty output (does not throw, returns {})", () => {
    expect(sanitizePartialDraft({} as any)).toEqual({});
  });

  it("keeps display_name of exactly 2 chars (boundary)", () => {
    expect(
      sanitizePartialDraft({ property: { display_name: "AB", city_slug: "blr" } } as any)
    ).toEqual({ property: { display_name: "AB", city_slug: "blr" } });
  });

  it("strips multiple invalid fields in one object, keeping the valid one", () => {
    expect(
      sanitizePartialDraft({
        property: { display_name: "X", city_slug: "", locality_slug: "valid" }
      } as any)
    ).toEqual({ property: { locality_slug: "valid" } });
  });

  it("keeps valid room_types entries while dropping invalid ones", () => {
    const r = sanitizePartialDraft({
      room_types: [
        { sharing: "single", ac: false, monthly_rent_paise: 0, vacancy_count: 1 },
        { sharing: "double", ac: true, monthly_rent_paise: 800000, vacancy_count: 4 }
      ]
    } as any);
    expect(r.room_types).toEqual([
      { sharing: "double", ac: true, monthly_rent_paise: 800000, vacancy_count: 4 }
    ]);
  });

  it("treats whitespace-only strings as empty", () => {
    expect(
      sanitizePartialDraft({ property: { display_name: "   ", city_slug: "blr" } } as any)
    ).toEqual({ property: { city_slug: "blr" } });
  });

  it("drops total_beds: 0 (boundary)", () => {
    expect(
      sanitizePartialDraft({ pg_details: { total_beds: 0 } } as any).pg_details?.total_beds
    ).toBeUndefined();
  });

  it("does not crash on falsy values inside room_types arrays", () => {
    const r = sanitizePartialDraft({ room_types: [null, undefined] } as any);
    expect(r.room_types).toBeUndefined();
  });
});
