import { describe, it, expect } from "vitest";
import { extractPropertyBasicsTool } from "../tools/extract-property-basics.tool";

const ctx = { sessionId: "s1", phase: "discovery" as const, locale: "en" as const };

describe("extract_property_basics", () => {
  it("returns ok=true with extracted fields when input is valid", () => {
    const r = extractPropertyBasicsTool.handler({ display_name: "Hostel A", total_floors: 3 }, ctx);
    expect(r.ok).toBe(true);
    expect(r.extracted.find((e) => e.field === "property.display_name")?.value).toBe("Hostel A");
    expect(r.extracted.find((e) => e.field === "property.total_floors")?.value).toBe(3);
  });

  it("returns ok=false with field-scoped errors when invalid", () => {
    const r = extractPropertyBasicsTool.handler({ display_name: "" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0].field).toMatch(/display_name/);
  });

  it("skips null optional fields in extracted output (strict null)", () => {
    const r = extractPropertyBasicsTool.handler({ display_name: "A", total_floors: null }, ctx);
    expect(r.ok).toBe(true);
    expect(r.extracted.find((e) => e.field === "property.total_floors")).toBeUndefined();
  });
});
