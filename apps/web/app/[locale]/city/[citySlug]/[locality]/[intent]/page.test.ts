import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../../lib/seo-api", () => ({
  fetchEnabledCities: vi.fn(),
  fetchLocality: vi.fn(),
  fetchListings: vi.fn(),
  fetchSeoCopy: vi.fn()
}));
vi.mock("../../../../../../lib/admin-preview", () => ({
  isAdminPreview: vi.fn().mockResolvedValue(false)
}));

import { generateMetadata } from "./page";
import { fetchEnabledCities, fetchListings, fetchLocality } from "../../../../../../lib/seo-api";

const mockedCities = vi.mocked(fetchEnabledCities);
const mockedLocality = vi.mocked(fetchLocality);
const mockedListings = vi.mocked(fetchListings);

const PARAMS = {
  locale: "en",
  citySlug: "lucknow",
  locality: "gomti-nagar",
  intent: "under-5000"
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedCities.mockResolvedValue(new Set(["lucknow"]));
  // The PARENT locality is comfortably above the threshold. That used to be the
  // only number the metadata looked at.
  mockedLocality.mockResolvedValue({
    locality: {
      id: 1,
      slug: "gomti-nagar",
      name_en: "Gomti Nagar",
      name_hi: "गोमती नगर",
      lat: 26.8,
      lng: 80.9,
      parent_locality_slug: null,
      listing_count: 8,
      own_listing_count: 8
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

describe("locality intent page metadata", () => {
  it("is noindex when no listing matches the intent, even though the locality is not thin", async () => {
    mockedListings.mockResolvedValue({ items: [], total: 0 });

    const meta = await generateMetadata({ params: PARAMS, searchParams: {} } as never);

    // The page renders an empty grid; the metadata must not claim otherwise.
    expect(meta.robots).toMatchObject({ index: false });
  });

  it("is indexable when enough listings match the intent itself", async () => {
    mockedListings.mockResolvedValue({ items: [], total: 5 });

    const meta = await generateMetadata({ params: PARAMS, searchParams: {} } as never);

    expect(meta.robots).toBeUndefined();
  });

  it("is noindex at one below the threshold", async () => {
    mockedListings.mockResolvedValue({ items: [], total: 2 });

    const meta = await generateMetadata({ params: PARAMS, searchParams: {} } as never);

    expect(meta.robots).toMatchObject({ index: false });
  });

  it("counts with the same city, locality and intent filters the page body renders", async () => {
    mockedListings.mockResolvedValue({ items: [], total: 4 });

    await generateMetadata({ params: PARAMS, searchParams: {} } as never);

    expect(mockedListings).toHaveBeenCalledTimes(1);
    const [query] = mockedListings.mock.calls[0];
    expect(query).toMatchObject({ city: "lucknow", locality: "gomti-nagar" });
    // Only the total is needed, so the metadata fetch stays cheap.
    expect(query).toMatchObject({ page_size: 1 });
  });
});
