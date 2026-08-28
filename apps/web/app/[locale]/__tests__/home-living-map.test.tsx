import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { HomeHeroMap } from "../../../components/home-hero-map";

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockDynamic({ children }: { children?: React.ReactNode }) {
      return <>{children ?? null}</>;
    }
}));

vi.mock("../../../lib/api", () => ({
  fetchApi: vi.fn()
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "unauthenticated", data: null })
}));

import { fetchApi } from "../../../lib/api";
import HomePage from "../page";

const mockedFetchApi = vi.mocked(fetchApi);

const LISTING = {
  id: "l1",
  title: "Spacious 2BHK Unfurnished Flat in Rashmi Khand Road, Lucknow",
  city: "lucknow",
  locality: "Rashmi Khand",
  listing_type: "flat_house",
  monthly_rent: 16000,
  bhk: 2,
  verification_status: "verified",
  cover_photo: "https://example.com/photo.jpg"
};

const PG_LISTING = {
  id: "pg1",
  title: "Girls Hostel near BBD University",
  city: "lucknow",
  locality: "Faizabad Road",
  listing_type: "pg",
  monthly_rent: 7000,
  verification_status: "verified",
  cover_photo: "https://example.com/pg.jpg"
};

const LOCALITIES = ["Gomti Nagar", "Indira Nagar", "Alambagh", "Hazratganj", "Aliganj"].map(
  (name, i) => ({
    locality_id: i + 1,
    locality_name: name,
    listing_count: 10 - i,
    city_slug: "lucknow"
  })
);

const POSTS = [
  {
    slug: "rent-trends-gomti-nagar",
    title: "Rent trends in Gomti Nagar",
    excerpt: "Where rents are heading.",
    category_slug: "data-reports",
    city_slug: "lucknow",
    hero_image_path: null,
    author: "Team Cribliv",
    published_at: "2026-08-20T00:00:00.000Z",
    data_asof: null
  },
  {
    slug: "pg-vs-flat",
    title: "PG or flat? A student's guide",
    excerpt: "The honest trade-offs.",
    category_slug: "guides",
    city_slug: "lucknow",
    hero_image_path: null,
    author: "Team Cribliv",
    published_at: "2026-08-18T00:00:00.000Z",
    data_asof: null
  },
  {
    slug: "lda-colony-guide",
    title: "Living in LDA Colony",
    excerpt: "A locality deep-dive.",
    category_slug: null,
    city_slug: "lucknow",
    hero_image_path: null,
    author: "Team Cribliv",
    published_at: "2026-08-15T00:00:00.000Z",
    data_asof: null
  }
];

function primeLiveMarket() {
  mockedFetchApi.mockImplementation(async (url: string) => {
    if (url.includes("/listings/search/map")) {
      return [
        {
          id: "p1",
          lat: 26.85,
          lng: 81.0,
          monthly_rent: 14000,
          listing_type: "flat_house",
          bhk: 2,
          verification_status: "verified",
          furnishing: null,
          city: "lucknow",
          locality: null,
          locality_slug: null
        }
      ];
    }
    if (url.includes("popular-localities")) return LOCALITIES;
    if (url.startsWith("/blog")) return { items: POSTS, total: 3 };
    if (url.includes("verified_only=true")) return { items: [], total: 88, page: 1, page_size: 1 };
    if (url.includes("city=lucknow") && url.includes("page_size=1"))
      return { items: [], total: 92, page: 1, page_size: 1 };
    if (url.includes("city=lucknow") && url.includes("listing_type=pg"))
      return { items: [PG_LISTING], total: 34, page: 1, page_size: 20 };
    if (url.includes("city=lucknow") && url.includes("listing_type=flat_house"))
      return { items: [LISTING], total: 92, page: 1, page_size: 20 };
    return { items: [], total: 0, page: 1, page_size: 1 };
  });
}

function primeEmptyMarket() {
  mockedFetchApi.mockImplementation(async (url: string) => {
    if (url.includes("/listings/search/map")) return [];
    return { items: [], total: 0, page: 1, page_size: 1 };
  });
}

beforeEach(() => {
  primeLiveMarket();
});

const MARKERS = [
  { id: "a", xPct: 40, yPct: 30, rentLabel: "₹14,000" },
  { id: "b", xPct: 70, yPct: 60, rentLabel: "₹6,000" }
];

describe("HomeHeroMap", () => {
  it("renders one price pill per marker at projected positions", () => {
    const { container } = render(
      <HomeHeroMap markers={MARKERS} featured={null} featuredHref={null} locale="en" />
    );
    const pills = container.querySelectorAll(".hero-map__marker");
    expect(pills).toHaveLength(2);
    expect(pills[0].textContent).toContain("₹14,000");
    expect((pills[0] as HTMLElement).style.left).toBe("40%");
    expect((pills[0] as HTMLElement).style.top).toBe("30%");
  });

  it("renders the SVG art and no markers when the market is empty", () => {
    const { container } = render(
      <HomeHeroMap markers={[]} featured={null} featuredHref={null} locale="en" />
    );
    expect(container.querySelector(".hero-map__art")).toBeTruthy();
    expect(container.querySelectorAll(".hero-map__marker")).toHaveLength(0);
    expect(container.textContent).not.toMatch(/unavailable|error/i);
  });

  it("shows the featured listing card only when a photo listing is provided", () => {
    const listing = {
      id: "l1",
      title: "3BHK Semi-Furnished Flat in LDA Colony, Lucknow",
      locality: "LDA Colony",
      monthly_rent: 20000,
      cover_photo: "https://example.com/p.jpg",
      verification_status: "verified" as const
    };
    const { container } = render(
      <HomeHeroMap markers={[]} featured={listing} featuredHref="/en/listing/l1" locale="en" />
    );
    const card = container.querySelector(".hero-map__card");
    expect(card).toBeTruthy();
    expect(card?.textContent).toContain("₹20,000");
    expect(card?.getAttribute("href")).toBe("/en/listing/l1");
  });
});

describe("living map homepage", () => {
  it("weaves the live verified count into a sentence, not a stat card", async () => {
    const ui = await HomePage({ params: { locale: "en" } });
    const { container } = render(ui);
    expect(container.textContent).toContain("88 verified homes");
    expect(container.querySelector(".home-market-band")).toBeNull();
    expect(container.querySelector(".impact-grid")).toBeNull();
    expect(container.querySelector(".hero-map")).toBeTruthy();
    expect(container.querySelectorAll(".hero-map__marker").length).toBe(1);
  });

  it("never renders dev-facing copy or error states", async () => {
    const ui = await HomePage({ params: { locale: "en" } });
    const { container } = render(ui);
    const text = container.textContent ?? "";
    for (const banned of [
      "search API",
      "backend",
      "hardcoded",
      "Live backend proof",
      "testimonial",
      "unavailable right now"
    ]) {
      expect(text).not.toContain(banned);
    }
  });

  it("renders the verification story, Maya chips, and owner band; old sections are gone", async () => {
    const ui = await HomePage({ params: { locale: "en" } });
    const { container } = render(ui);

    expect(container.querySelector(".home-verify")).toBeTruthy();
    expect(container.textContent).toContain("How a home gets verified");
    const steps = container.querySelectorAll(".home-verify__step");
    expect(steps).toHaveLength(3);
    steps.forEach((step) => {
      expect(step.querySelector("h3")?.textContent).toBeTruthy();
      expect(step.querySelector("p")?.textContent).toBeTruthy();
    });
    // 88 of 92 → 96% woven into a sentence
    expect(container.textContent).toContain("96% of live listings are verified");

    const chips = container.querySelectorAll(".home-maya__chip");
    expect(chips.length).toBeGreaterThanOrEqual(3);
    expect(chips[0].getAttribute("href")).toContain("/en/search?q=");

    expect(container.querySelector(".home-owner-band")).toBeTruthy();
    // deleted sections
    expect(container.querySelector("[data-testid='home-how-it-works']")).toBeNull();
    expect(container.querySelector(".ai-showcase")).toBeNull();
    expect(container.querySelector(".browse-bento")).toBeNull();
    expect(container.querySelector(".home-proof-grid")).toBeNull();
    expect(container.querySelector(".cta-banner")).toBeNull();
  });

  it("drops the count sentence when the market comes back empty", async () => {
    primeEmptyMarket();
    const ui = await HomePage({ params: { locale: "en" } });
    const { container } = render(ui);
    expect(container.textContent).not.toMatch(/verified homes/);
    expect(container.textContent).not.toMatch(/\b0 (verified|live)/);
    expect(container.querySelectorAll(".hero-map__marker")).toHaveLength(0);
  });

  it("renders the PG rail, locality chips, and Cribliv Times strip from live data", async () => {
    const ui = await HomePage({ params: { locale: "en" } });
    const { container } = render(ui);

    expect(container.textContent).toContain("PGs & co-living near every campus");
    expect(container.textContent).toContain("Girls Hostel near BBD University");

    const chips = container.querySelectorAll(".home-locality-chip");
    expect(chips.length).toBe(5);
    expect(chips[0].getAttribute("href")).toContain("/en/search?city=lucknow&q=");
    expect(chips[0].textContent).toContain("Gomti Nagar");

    const posts = container.querySelectorAll(".home-times__card");
    expect(posts).toHaveLength(3);
    expect(posts[0].getAttribute("href")).toBe("/en/blog/rent-trends-gomti-nagar");
    expect(container.textContent).toContain("Rent trends in Gomti Nagar");
  });

  it("hides the PG rail, locality chips, and Times strip when their data is missing", async () => {
    primeEmptyMarket();
    const ui = await HomePage({ params: { locale: "en" } });
    const { container } = render(ui);
    expect(container.querySelector(".home-locality-chip")).toBeNull();
    expect(container.querySelector(".home-times__card")).toBeNull();
    expect(container.textContent).not.toContain("PGs & co-living");
    expect(container.textContent).not.toMatch(/unavailable/i);
  });
});
