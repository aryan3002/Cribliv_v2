import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../lib/blog-api", () => ({ fetchBlogList: vi.fn() }));
import { fetchBlogList } from "../../../../../lib/blog-api";
import { GET } from "../route";

const asMock = fetchBlogList as unknown as ReturnType<typeof vi.fn>;

describe("GET /api/nav/times", () => {
  // Braces are load-bearing. A concise arrow returns mockReset()'s value —
  // the mock itself — and Vitest treats a function returned from beforeEach
  // as a teardown callback, so it CALLS the mock after each test. For the
  // rejection case that manufactures a rejected promise nobody awaits, and
  // the resulting unhandled rejection fails a test whose assertions all pass.
  beforeEach(() => {
    asMock.mockReset();
  });

  it("returns at most 4 posts, newest first as the API ordered them", async () => {
    asMock.mockResolvedValue({
      items: Array.from({ length: 9 }, (_, i) => ({
        slug: `post-${i}`,
        title: `Post ${i}`,
        category_slug: "tenancy"
      }))
    });
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.posts).toHaveLength(4);
    expect(body.posts[0]).toEqual({ slug: "post-0", title: "Post 0", category: "tenancy" });
  });

  it("returns an empty list, not an error, when the blog API throws", async () => {
    asMock.mockRejectedValue(new Error("upstream down"));
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).posts).toEqual([]);
  });

  it("returns an empty list when the response has no items", async () => {
    asMock.mockResolvedValue({});
    const res = await GET();
    expect((await res.json()).posts).toEqual([]);
  });

  it("skips posts missing a slug or a title rather than emitting a broken link", async () => {
    asMock.mockResolvedValue({
      items: [
        { slug: "", title: "No slug", category_slug: null },
        { slug: "ok", title: "Fine", category_slug: null },
        { slug: "no-title", title: "", category_slug: null }
      ]
    });
    expect((await (await GET()).json()).posts).toEqual([
      { slug: "ok", title: "Fine", category: null }
    ]);
  });

  it("sets a cache header so repeat hits do not reach the blog API", async () => {
    asMock.mockResolvedValue({ items: [] });
    const res = await GET();
    expect(res.headers.get("cache-control")).toContain("s-maxage");
  });
});
