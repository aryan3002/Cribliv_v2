import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/seo-api", () => ({
  fetchListings: vi.fn(),
  fetchLocalities: vi.fn(async () => []),
  fetchLandmarks: vi.fn(async () => []),
  fetchMetroStationsForCity: vi.fn(async () => []),
  fetchEnabledCities: vi.fn(async () => new Set(["lucknow"]))
}));
vi.mock("../../../../lib/api", () => ({
  fetchApi: vi.fn(async () => ({ items: [], total: 0 })),
  buildSearchQuery: vi.fn(() => "")
}));

import { generateMetadata } from "./page";
import { fetchListings } from "../../../../lib/seo-api";

const mockedListings = vi.mocked(fetchListings);

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * The city hub had NO robots rule at all, so it inherited the root layout's
 * `robots: { index: true, follow: true }` (apps/web/app/layout.tsx:58). Verified
 * on production 2026-07-26: /en/city/varanasi returned HTTP 200 with
 * `<meta name="robots" content="index, follow">` while rendering fabricated
 * "Popular Areas in Varanasi" — Sector 1, Sector 2, Central.
 *
 * Because the layout sets a positive default, a thin hub must set `index: false`
 * EXPLICITLY — omitting robots is not enough.
 */
describe("city hub metadata", () => {
  it("is noindex when the city has no inventory", async () => {
    mockedListings.mockResolvedValue({ items: [], total: 0 });

    const meta = await generateMetadata({
      params: { locale: "en", citySlug: "varanasi" }
    } as never);

    expect(meta.robots).toMatchObject({ index: false });
  });

  it("is noindex when the city is below the threshold", async () => {
    mockedListings.mockResolvedValue({ items: [], total: 2 });

    const meta = await generateMetadata({
      params: { locale: "en", citySlug: "chandigarh" }
    } as never);

    expect(meta.robots).toMatchObject({ index: false });
  });

  it("stays indexable once the city clears the threshold", async () => {
    mockedListings.mockResolvedValue({ items: [], total: 3 });

    const meta = await generateMetadata({
      params: { locale: "en", citySlug: "lucknow" }
    } as never);

    // Undefined lets the root layout's index,follow default apply.
    expect(meta.robots).toBeUndefined();
  });

  it("counts city-wide inventory, not per-locality — hubs legitimately aggregate", async () => {
    mockedListings.mockResolvedValue({ items: [], total: 5 });

    await generateMetadata({ params: { locale: "en", citySlug: "lucknow" } } as never);

    expect(mockedListings).toHaveBeenCalledTimes(1);
    const [query, opts] = mockedListings.mock.calls[0];
    expect(query).toMatchObject({ city: "lucknow", page_size: 1 });
    // Must stay ISR-cached: a no-store fetch here would force the hub — and its
    // hourly revalidation — into per-request dynamic rendering.
    expect(opts).toMatchObject({ revalidate: 3600 });
  });

  it("keeps the title and canonical intact", async () => {
    mockedListings.mockResolvedValue({ items: [], total: 9 });

    const meta = await generateMetadata({
      params: { locale: "en", citySlug: "lucknow" }
    } as never);

    expect(meta.title).toContain("Lucknow");
    expect(meta.alternates?.canonical).toContain("/en/city/lucknow");
  });
});
