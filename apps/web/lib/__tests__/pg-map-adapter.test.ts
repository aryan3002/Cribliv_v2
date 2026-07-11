import { describe, expect, it } from "vitest";
import { pgCardToSearchMapListing } from "../pg-map-adapter";
import type { PgCard } from "../pg-public-api";

const card: PgCard = {
  id: "1",
  title: "Cozy PG",
  city: "lucknow",
  city_name: "Lucknow",
  locality: "Gomti Nagar",
  listing_type: "pg",
  starting_rent: 9000,
  sharing_options: ["double"],
  gender_policy: "coed",
  food_included: true,
  verified: true,
  cover_photo: null,
  lat: 26.8551,
  lng: 80.941
};

describe("pgCardToSearchMapListing", () => {
  it("maps starting_rent to monthly_rent and verified to verification_status", () => {
    expect(pgCardToSearchMapListing(card)).toMatchObject({
      id: "1",
      listing_type: "pg",
      monthly_rent: 9000,
      verification_status: "verified",
      lat: 26.8551,
      lng: 80.941,
      city: "lucknow"
    });
  });

  it("defaults null rent to 0 and unverified to pending", () => {
    const mapped = pgCardToSearchMapListing({
      ...card,
      starting_rent: null,
      verified: false
    });

    expect(mapped.monthly_rent).toBe(0);
    expect(mapped.verification_status).toBe("pending");
  });
});
