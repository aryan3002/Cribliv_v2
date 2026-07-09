import { describe, it, expect } from "vitest";
import { mapFlat, mapFurnishing, mapTenantPref, composeTitleFromAddress } from "../map-flat";

describe("composeTitleFromAddress", () => {
  it("passes through a stored nameListing", () => {
    expect(composeTitleFromAddress({ nameListing: "3 BHK near Alambagh" })).toBe(
      "3 BHK near Alambagh"
    );
  });
  it("composes from address when nameListing is blank, de-duping repeated tokens", () => {
    // All 19 v1 PGs have blank nameListing; v1 composes from address at render.
    expect(
      composeTitleFromAddress(
        { nameListing: "", society: "GLS Hotel", landmark: "HCLTech IT City", city: "Lucknow" },
        "PG in"
      )
    ).toBe("PG in GLS Hotel, HCLTech IT City, Lucknow");
  });
  it("drops empty slots and de-dupes case-insensitively", () => {
    expect(
      composeTitleFromAddress({
        nameListing: "  ",
        society: "",
        landmark: "Lucknow",
        city: "lucknow"
      })
    ).toBe("Lucknow");
  });
  it("falls back to 'Listing' when everything is blank", () => {
    expect(composeTitleFromAddress({ nameListing: "" })).toBe("Listing");
  });
});

describe("mapFurnishing", () => {
  it("maps known values", () => {
    expect(mapFurnishing("Fully Furnished")).toBe("fully_furnished");
    expect(mapFurnishing("semi furnished")).toBe("semi_furnished");
    expect(mapFurnishing("Unfurnished")).toBe("unfurnished");
  });
  it("returns null for unknown", () => {
    expect(mapFurnishing("banana")).toBeNull();
    expect(mapFurnishing(undefined)).toBeNull();
  });
});

describe("mapTenantPref", () => {
  it("maps values", () => {
    expect(mapTenantPref("Family")).toBe("family");
    expect(mapTenantPref("Bachelors")).toBe("bachelor");
    expect(mapTenantPref("Anyone")).toBe("any");
  });
});

describe("mapFlat", () => {
  const doc = {
    _id: "abc",
    nameListing: "3 BHK near Alambagh",
    description: "Nice flat",
    expected_rent: 18000,
    expected_deposit: 36000,
    bedrooms: 3,
    bathrooms: 2,
    area: 1200,
    furnishing: "Semi Furnished",
    pref_tenant: "Family",
    city: "Lucknow ",
    houseNum: "12",
    society: "Green Society",
    landmark: "Near Metro",
    pincode: 226005,
    amenities: ["Lift", "Parking"],
    location: { type: "Point", coordinates: [80.9, 26.8] as [number, number] },
    cloudinary_public_ids: ["cribliv/properties/abc/1.png"],
    verified: true
  };
  it("maps core fields and [lng,lat] geo", () => {
    const f = mapFlat(doc);
    expect(f.v1Id).toBe("abc");
    expect(f.monthlyRent).toBe(18000);
    expect(f.bhk).toBe(3);
    expect(f.citySlug).toBe("lucknow");
    expect(f.lat).toBe(26.8);
    expect(f.lng).toBe(80.9);
    expect(f.addressLine1).toContain("Green Society");
    expect(f.publicIds).toEqual(["cribliv/properties/abc/1.png"]);
    expect(f.warnings).toEqual([]);
  });
  it("warns and defaults when rent missing / city unknown / no geo", () => {
    const f = mapFlat({ _id: "x", nameListing: "X", city: "Atlantis" } as any);
    expect(f.warnings).toContain("no rent");
    expect(f.warnings).toContain("unknown city: Atlantis");
    expect(f.warnings).toContain("no geo");
    expect(f.addressLine1.length).toBeGreaterThan(0); // never empty (NOT NULL col)
  });
});
