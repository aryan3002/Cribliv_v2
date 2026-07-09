import { describe, it, expect } from "vitest";
import { mapPgAmenities } from "../map-pg";
import { mapRoomTypes, sharingFromBedType } from "../map-pg";

describe("mapPgAmenities", () => {
  it("buckets the real v1 PG amenity names", () => {
    const r = mapPgAmenities([
      { amenityName: "Air Conditioner" },
      { amenityName: "Water Geyser" },
      { amenityName: "WiFi" },
      { amenityName: "Television" },
      { amenityName: "Wardrobe" },
      { amenityName: "Washing Machine" },
      { amenityName: "Fridge" },
      { amenityName: "Microwave" }
    ]);
    expect(r.room).toEqual(expect.arrayContaining(["ac", "tv", "wardrobe"]));
    expect(r.core).toEqual(expect.arrayContaining(["hot_water", "wifi"]));
    expect(r.services).toContain("laundry"); // Washing Machine
    expect(r.extras).toEqual(expect.arrayContaining(["fridge", "microwave"]));
  });
  it("accepts a bare string[] too", () => {
    expect(mapPgAmenities(["Parking"]).extras).toContain("parking_2w");
  });
  it("reports Room Heater as unmapped (no v2 code) without throwing", () => {
    const r = mapPgAmenities([{ amenityName: "Room Heater" }]);
    expect(r.unmapped).toContain("Room Heater");
    expect(r.core.length + r.room.length + r.services.length + r.extras.length).toBe(0);
  });
});

describe("sharingFromBedType", () => {
  it("maps bed.type string → sharing kind (four → quad)", () => {
    expect(sharingFromBedType("single")).toBe("single");
    expect(sharingFromBedType("double")).toBe("double");
    expect(sharingFromBedType("triple")).toBe("triple");
    expect(sharingFromBedType("four")).toBe("quad");
    expect(sharingFromBedType("Four")).toBe("quad");
  });
});

describe("mapRoomTypes", () => {
  it("uses bed.type as sharing, count as vacancy, rent → paise, shared → shared_western", () => {
    // Real v1 shape: beds:[{type: <sharing>, count: <quantity>}], area often 0.
    const rt = mapRoomTypes([
      {
        beds: [{ type: "double", count: 5 }],
        bathrooms: [{ type: "shared" }],
        expected_rent: 4000,
        area: 0
      }
    ]);
    expect(rt[0].sharing).toBe("double");
    expect(rt[0].vacancyCount).toBe(5);
    expect(rt[0].monthlyRentPaise).toBe(400000);
    expect(rt[0].bathroomKind).toBe("shared_western");
    expect(rt[0].roomSizeSqft).toBeNull(); // area 0 → null
    expect(rt[0].ac).toBe(false); // v1 has no per-room AC
  });
  it("aggregates rooms that collapse to the same (sharing,ac,bathroom,furnishing) tuple", () => {
    // The pg_room_types UNIQUE key would otherwise ON CONFLICT-overwrite the first.
    const rt = mapRoomTypes([
      {
        beds: [{ type: "single", count: 2 }],
        bathrooms: [{ type: "private" }],
        expected_rent: 8000
      },
      {
        beds: [{ type: "single", count: 3 }],
        bathrooms: [{ type: "private" }],
        expected_rent: 7000
      }
    ]);
    expect(rt).toHaveLength(1);
    expect(rt[0].vacancyCount).toBe(5); // 2 + 3
    expect(rt[0].monthlyRentPaise).toBe(700000); // min positive rent
    expect(rt[0].bathroomKind).toBe("attached_western"); // private → attached_western
  });
});
