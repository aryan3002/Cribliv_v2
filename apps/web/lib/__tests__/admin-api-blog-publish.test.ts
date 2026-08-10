import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>();
  return { ...actual, fetchApi: vi.fn() };
});

import { fetchApi } from "../api";
import { publishBlogPost, approveBlogPost } from "../admin-api";

const mockedFetch = vi.mocked(fetchApi);

const RAW_ROW = {
  id: "P1",
  slug: "rooms-for-rent-near-me",
  title: "Rooms for Rent Near Me",
  status: "published",
  category_slug: "market-updates",
  city_slug: "lucknow",
  author: "Cribliv Data Desk",
  quality_score: 0.9,
  excerpt: null,
  updated_at: "2026-08-10T08:09:00Z",
  published_at: "2026-08-10T08:09:00Z"
};

describe("blog publish revalidation", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("publish busts the ISR cache for every page the story prints on", async () => {
    mockedFetch.mockResolvedValueOnce(RAW_ROW as never);
    await publishBlogPost("tok", "P1");

    const revalidateCall = vi
      .mocked(global.fetch)
      .mock.calls.find(([url]) => url === "/api/revalidate");
    expect(revalidateCall).toBeDefined();
    const body = JSON.parse((revalidateCall![1] as RequestInit).body as string) as {
      paths: string[];
    };
    expect(body.paths).toContain("/en/blog");
    expect(body.paths).toContain("/hi/blog");
    expect(body.paths).toContain("/en/blog/rooms-for-rent-near-me");
    expect(body.paths).toContain("/en/blog/category/market-updates");
    expect(body.paths).toContain("/en/blog/author/cribliv-data-desk");
  });

  it("approve does not touch the public cache", async () => {
    mockedFetch.mockResolvedValueOnce({ ...RAW_ROW, status: "approved" } as never);
    await approveBlogPost("tok", "P1");
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });
});
