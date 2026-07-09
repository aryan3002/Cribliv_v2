import { describe, it, expect } from "vitest";
import { resolveOwnerPhone } from "../owners";

describe("resolveOwnerPhone", () => {
  const excel = new Map<string, string>([["green villa", "+919111111111"]]);
  it("Tier 1: uses mongo ownerPhone", () => {
    const r = resolveOwnerPhone({ ownerPhone: "9998887776", nameListing: "Green Villa" }, excel);
    expect(r).toEqual({ phone: "+919998887776", source: "mongo" });
  });
  it("Tier 2: falls back to Excel by name", () => {
    const r = resolveOwnerPhone({ ownerPhone: "", nameListing: "Green Villa" }, excel);
    expect(r).toEqual({ phone: "+919111111111", source: "excel" });
  });
  it("Tier 3: import fallback when neither present", () => {
    const r = resolveOwnerPhone({ ownerPhone: "", nameListing: "Unknown" }, excel);
    expect(r.source).toBe("import_fallback");
    expect(r.phone).toBeNull();
  });
  it("Tier 3: import fallback when mongo phone is malformed", () => {
    const r = resolveOwnerPhone({ ownerPhone: "904440412", nameListing: "Unknown" }, excel);
    expect(r.source).toBe("import_fallback");
  });
});
