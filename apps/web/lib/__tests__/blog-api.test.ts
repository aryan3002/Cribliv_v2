import { describe, it, expect, vi, afterEach } from "vitest";
import * as api from "../api";
import { fetchBlogList, fetchBlogPost, fetchAllBlogSlugs } from "../blog-api";

afterEach(() => vi.restoreAllMocks());

describe("blog-api", () => {
  it("fetchBlogList calls /blog with query params, server-side", async () => {
    const spy = vi.spyOn(api, "fetchApi").mockResolvedValue({ items: [], total: 0 } as never);
    await fetchBlogList({ page: 2, city: "lucknow" });
    const [path, , opts] = spy.mock.calls[0];
    expect(String(path)).toContain("/blog?");
    expect(String(path)).toContain("city=lucknow");
    expect(String(path)).toContain("page=2");
    expect(opts).toMatchObject({ server: true });
  });

  it("fetchBlogList swallows API errors and returns an empty list", async () => {
    vi.spyOn(api, "fetchApi").mockRejectedValue(new Error("boom"));
    await expect(fetchBlogList()).resolves.toEqual({ items: [], total: 0 });
  });

  it("fetchBlogPost returns null when the API returns null data", async () => {
    vi.spyOn(api, "fetchApi").mockResolvedValue(null as never);
    await expect(fetchBlogPost("nope")).resolves.toBeNull();
  });

  it("fetchAllBlogSlugs pages through the list", async () => {
    vi.spyOn(api, "fetchApi").mockResolvedValueOnce({
      items: [{ slug: "a" }, { slug: "b" }],
      total: 2
    } as never);
    const slugs = await fetchAllBlogSlugs();
    expect(slugs).toEqual(["a", "b"]);
  });
});
