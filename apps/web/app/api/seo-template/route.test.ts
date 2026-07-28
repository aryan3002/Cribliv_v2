import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../lib/seo-api", () => ({
  fetchLocality: vi.fn(),
  fetchCityMetroStations: vi.fn()
}));

import { GET } from "./route";
import { fetchLocality, fetchCityMetroStations } from "../../../lib/seo-api";

const mockedLocality = vi.mocked(fetchLocality);
const mockedMetro = vi.mocked(fetchCityMetroStations);

function req(qs: string) {
  return new Request(`http://localhost/api/seo-template?${qs}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedMetro.mockResolvedValue([]);
});

describe("GET /api/seo-template", () => {
  it("400s without city/locality params", async () => {
    const res = await GET(req(""));
    expect(res.status).toBe(400);
  });

  it("returns null data when the locality is unknown", async () => {
    mockedLocality.mockResolvedValue(null);
    const res = await GET(req("city=lucknow&locality=nope"));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toBeNull();
  });

  it("returns the template copy for a known locality", async () => {
    mockedLocality.mockResolvedValue({
      locality: {
        id: 1,
        slug: "gomti-nagar",
        name_en: "Gomti Nagar",
        name_hi: "गोमती नगर",
        lat: 26.85,
        lng: 80.99,
        parent_locality_slug: null,
        listing_count: 8
      },
      aggregates: {
        listing_count: 8,
        pg_count: 2,
        flat_count: 6,
        median_rent_pg: 6000,
        median_rent_1bhk: 12000,
        median_rent_2bhk: 18000,
        median_rent_3bhk: null
      }
    } as never);
    mockedMetro.mockResolvedValue([
      { station_name: "CCS Airport", line_name: "Red Line", lat: 26.9, lng: 80.9 }
    ] as never);

    const res = await GET(req("city=lucknow&locality=gomti-nagar&locale=en"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.h1).toContain("Gomti Nagar");
    expect(body.data.meta_title).toContain("Gomti Nagar");
    expect(body.data.intro_paragraph).toContain("₹12,000/mo");
    expect(body.data.faq_items).toHaveLength(4);
  });

  it("sources stations city-scoped so copy cannot name another city's metro", async () => {
    mockedLocality.mockResolvedValue({
      locality: {
        id: 1,
        slug: "gomti-nagar",
        name_en: "Gomti Nagar",
        name_hi: "गोमती नगर",
        lat: 26.85,
        lng: 80.99,
        parent_locality_slug: null,
        listing_count: 8
      },
      aggregates: {
        listing_count: 8,
        pg_count: 2,
        flat_count: 6,
        median_rent_pg: 6000,
        median_rent_1bhk: 12000,
        median_rent_2bhk: 18000,
        median_rent_3bhk: null
      }
    } as never);
    mockedMetro.mockResolvedValue([]);

    await GET(req("city=lucknow&locality=gomti-nagar&locale=en"));

    // /map/metro returns whole lines touching a city; this must be the
    // city-scoped endpoint or a Lucknow locality could be described as being
    // near a Delhi station.
    expect(mockedMetro).toHaveBeenCalledWith("lucknow");
  });
});
