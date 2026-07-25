import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../lib/seo-api", () => ({
  fetchEnabledCities: vi.fn(),
  fetchLocality: vi.fn(),
  fetchSeoCopy: vi.fn(),
  fetchLandmarks: vi.fn(),
  fetchListings: vi.fn(),
  fetchLocalities: vi.fn(),
  fetchMetroStationsForCity: vi.fn()
}));

import { generateMetadata } from "./page";
import { fetchEnabledCities, fetchLocality, fetchSeoCopy } from "../../../../../lib/seo-api";

const mockedCities = vi.mocked(fetchEnabledCities);
const mockedLocality = vi.mocked(fetchLocality);
const mockedCopy = vi.mocked(fetchSeoCopy);

const PARAMS = { locale: "en", citySlug: "lucknow", locality: "gomti-nagar" };

beforeEach(() => {
  vi.clearAllMocks();
  mockedCities.mockResolvedValue(new Set(["lucknow"]));
  mockedLocality.mockResolvedValue({
    locality: {
      slug: "gomti-nagar",
      name_en: "Gomti Nagar",
      name_hi: "गोमती नगर",
      lat: 26.8,
      lng: 80.9,
      parent_locality_slug: null
    },
    aggregates: {
      listing_count: 8,
      pg_count: 2,
      flat_count: 6,
      median_rent_pg: null,
      median_rent_1bhk: 12000,
      median_rent_2bhk: 18000,
      median_rent_3bhk: null
    }
  } as never);
});

describe("locality generateMetadata meta override wiring", () => {
  it("uses the stored meta_title / meta_description when present", async () => {
    mockedCopy.mockResolvedValue({
      h1: "x",
      meta_title: "Custom Meta Title",
      meta_description: "Custom meta description.",
      intro_paragraph: "",
      nearby_blurb: null,
      faq_items: []
    });

    const meta = await generateMetadata({ params: PARAMS });

    expect(meta.title).toBe("Custom Meta Title");
    expect(meta.description).toBe("Custom meta description.");
  });

  it("falls back to the template title/description when there is no stored copy", async () => {
    mockedCopy.mockResolvedValue(null);

    const meta = await generateMetadata({ params: PARAMS });

    expect(String(meta.title)).toContain("Gomti Nagar");
    expect(String(meta.description)).toContain("Gomti Nagar");
  });

  it("ignores blank stored meta and keeps the template", async () => {
    mockedCopy.mockResolvedValue({
      h1: "",
      meta_title: "   ",
      meta_description: "",
      intro_paragraph: "",
      nearby_blurb: null,
      faq_items: []
    });

    const meta = await generateMetadata({ params: PARAMS });

    expect(String(meta.title)).toContain("Gomti Nagar");
  });
});
