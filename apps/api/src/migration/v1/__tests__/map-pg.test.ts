import { describe, it, expect } from "vitest";
import { mapPgAmenities } from "../map-pg";

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
