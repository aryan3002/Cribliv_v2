import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api", () => ({ fetchApi: vi.fn() }));
vi.mock("../pg-public-api", () => ({ getPgPublicListing: vi.fn() }));

import { fetchApi } from "../api";
import { getPgPublicListing } from "../pg-public-api";
import { fetchListingCard, fetchPgCard } from "../blog-embed-cards";

const mockedFetch = vi.mocked(fetchApi);
const mockedPg = vi.mocked(getPgPublicListing);

beforeEach(() => vi.clearAllMocks());

describe("fetchListingCard", () => {
  it("maps a listing detail into ListingCardData (cover = first photo)", async () => {
    mockedFetch.mockResolvedValue({
      listing_detail: {
        id: "L1",
        title: "2BHK in Gomti Nagar",
        listing_type: "flat_house",
        monthly_rent: 18000,
        verification_status: "verified",
        city: "lucknow",
        locality: "gomti-nagar",
        bhk: 2,
        area_sqft: 900,
        furnishing: "semi_furnished",
        photos: ["https://img/a.jpg", "https://img/b.jpg"]
      }
    } as never);

    const card = await fetchListingCard("L1");

    // track_view=0 is the point: rendering an embed card is not a listing view,
    // and this endpoint is the only place a view is persisted. Without it, every
    // render of an article inflated the embedded listings' view counts.
    expect(mockedFetch).toHaveBeenCalledWith(
      "/listings/L1?track_view=0",
      undefined,
      expect.objectContaining({ server: true })
    );
    expect(card).toMatchObject({
      id: "L1",
      title: "2BHK in Gomti Nagar",
      listing_type: "flat_house",
      monthly_rent: 18000,
      verification_status: "verified",
      city: "lucknow",
      locality: "gomti-nagar",
      bhk: 2,
      cover_photo: "https://img/a.jpg"
    });
  });

  it("returns null when the listing fetch fails", async () => {
    mockedFetch.mockRejectedValue(new Error("404"));
    expect(await fetchListingCard("nope")).toBeNull();
  });
});

describe("fetchPgCard", () => {
  it("maps a pg detail into a PgCard (paise->rupee, cover, sharing)", async () => {
    mockedPg.mockResolvedValue({
      id: "P1",
      status: "published",
      title: "Cozy PG",
      monthly_rent: null,
      city_slug: "lucknow",
      locality_slug: "hazratganj",
      verification_status: "verified",
      location_point: { lat: 26.8, lng: 80.9 },
      pg_details: { gender_policy: "female", meal_charges_paise: 150000 },
      room_types: [
        { sharing: "double", monthly_rent_paise: 900000 },
        { sharing: "single", monthly_rent_paise: 1200000 }
      ],
      photos: [
        { blob_path: "a.jpg", is_cover: false },
        { blob_path: "cover.jpg", is_cover: true }
      ]
    } as never);

    const card = await fetchPgCard("lucknow", "P1");

    expect(card).toMatchObject({
      id: "P1",
      title: "Cozy PG",
      city: "lucknow",
      locality: "hazratganj",
      listing_type: "pg",
      starting_rent: 9000,
      verified: true,
      gender_policy: "female",
      food_included: true,
      cover_photo: "cover.jpg"
    });
    expect(card?.sharing_options).toEqual(expect.arrayContaining(["double", "single"]));
  });

  it("returns null when the pg fetch fails", async () => {
    mockedPg.mockRejectedValue(new Error("404"));
    expect(await fetchPgCard("lucknow", "nope")).toBeNull();
  });
});
