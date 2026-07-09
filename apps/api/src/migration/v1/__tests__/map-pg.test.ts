import { describe, it, expect } from "vitest";
import { mapPgAmenities } from "../map-pg";
import { mapPg, mapRoomTypes, sharingFromBedType } from "../map-pg";

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
  it("defaults an unknown bed type to single", () => {
    expect(sharingFromBedType("studio")).toBe("single");
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
  it("takes the min positive rent when a same-tuple room has 0 rent first", () => {
    const rt = mapRoomTypes([
      { beds: [{ type: "single", count: 1 }], bathrooms: [{ type: "private" }], expected_rent: 0 },
      {
        beds: [{ type: "single", count: 1 }],
        bathrooms: [{ type: "private" }],
        expected_rent: 6000
      }
    ]);
    expect(rt).toHaveLength(1);
    expect(rt[0].monthlyRentPaise).toBe(600000);
    expect(rt[0].vacancyCount).toBe(2);
  });
});

describe("mapPg", () => {
  it("maps a full PG doc (title from address, min-positive starting rent, summed beds)", () => {
    const p = mapPg({
      _id: "pg1",
      nameListing: "",
      society: "GLS Hotel",
      landmark: "IT City",
      city: "Lucknow",
      location: { coordinates: [80.9, 26.8] },
      rooms: [
        {
          beds: [{ type: "double", count: 5 }],
          bathrooms: [{ type: "shared" }],
          expected_rent: 4000,
          area: 0
        },
        {
          beds: [{ type: "single", count: 2 }],
          bathrooms: [{ type: "private" }],
          expected_rent: 8000
        }
      ],
      amenities: [{ amenityName: "WiFi" }, { amenityName: "Air Conditioner" }],
      cloudinary_public_ids: ["cribliv/pgs/pg1/1.png"]
    } as any);
    expect(p.v1Id).toBe("pg1");
    expect(p.titleEn).toBe("PG in GLS Hotel, IT City, Lucknow");
    expect(p.citySlug).toBe("lucknow");
    expect(p.lat).toBe(26.8);
    expect(p.lng).toBe(80.9);
    expect(p.rooms).toHaveLength(2);
    expect(p.startingRentPaise).toBe(400000); // min positive: 4000 * 100
    expect(p.totalBeds).toBe(7); // 5 + 2
    expect(p.amenities.core).toContain("wifi");
    expect(p.amenities.room).toContain("ac");
    expect(p.warnings).toEqual([]);
  });
  it("warns and stays null-safe on a sparse PG doc", () => {
    const p = mapPg({ _id: "pg2", nameListing: "", city: "Atlantis" } as any);
    expect(p.warnings).toContain("no rooms");
    expect(p.warnings).toContain("no room rent");
    expect(p.warnings).toContain("unknown city: Atlantis");
    expect(p.warnings).toContain("no geo");
    expect(p.rooms).toEqual([]);
    expect(p.startingRentPaise).toBe(0);
    expect(p.titleEn.length).toBeGreaterThan(0);
  });
});
