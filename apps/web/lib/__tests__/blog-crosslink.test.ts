import { describe, expect, it } from "vitest";
import { matchTimesStories, slugMentionsLocality } from "../blog-crosslink";
import type { BlogListItem } from "../blog-api";

const story = (slug: string): BlogListItem => ({
  slug,
  title: slug,
  excerpt: null,
  category_slug: "data-reports",
  city_slug: "lucknow",
  hero_image_path: null,
  author: "Aditi Sharma",
  published_at: "2026-08-01T00:00:00Z",
  data_asof: null
});

describe("slugMentionsLocality", () => {
  it("matches a single-token locality inside a post slug", () => {
    expect(slugMentionsLocality("rent-trends-in-alambagh", "alambagh")).toBe(true);
  });

  it("matches a multi-token locality only as a consecutive run", () => {
    expect(
      slugMentionsLocality("2-bhk-flats-in-indira-nagar-lucknow-for-rent", "indira-nagar")
    ).toBe(true);
    expect(slugMentionsLocality("indira-colony-nagar-guide", "indira-nagar")).toBe(false);
  });

  it("does not match partial tokens", () => {
    expect(slugMentionsLocality("rent-trends-in-alambagh", "alam")).toBe(false);
  });
});

describe("matchTimesStories", () => {
  const items = [
    story("pgs-in-lucknow"),
    story("rent-trends-in-hazratganj"),
    story("rent-trends-in-alambagh"),
    story("tenant-rights-in-india")
  ];

  it("ranks locality-matched stories first, then fills to the limit", () => {
    expect(matchTimesStories(items, "alambagh", 3).map((s) => s.slug)).toEqual([
      "rent-trends-in-alambagh",
      "pgs-in-lucknow",
      "rent-trends-in-hazratganj"
    ]);
  });

  it("falls back to city stories when nothing matches the locality", () => {
    expect(matchTimesStories(items, "gomti-nagar", 2).map((s) => s.slug)).toEqual([
      "pgs-in-lucknow",
      "rent-trends-in-hazratganj"
    ]);
  });
});
