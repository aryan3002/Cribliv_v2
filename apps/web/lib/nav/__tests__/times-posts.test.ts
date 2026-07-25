import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { loadTimesPosts, __resetTimesPostsForTests, type TimesPost } from "../times-posts";

const SAMPLE: TimesPost[] = [
  { slug: "rent-report-2026", title: "Lucknow Rent Report 2026", category: "data-reports" }
];

function okJson(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) };
}

describe("loadTimesPosts", () => {
  // Braces are load-bearing. A concise arrow returns mockReset()'s value — the
  // mock itself — and Vitest treats a function returned from beforeEach as a
  // teardown callback, so it CALLS the mock after every test. Since
  // loadTimesPosts is fetch-based, that manufactures a stray promise nobody
  // awaits; for the rejection tests below it would be a rejected one, and the
  // resulting unhandled rejection fails a test whose assertions all passed.
  // (Diagnosed by bisection on the /api/nav/times route's own test — see the
  // comment there.)
  beforeEach(() => {
    fetchMock.mockReset();
    __resetTimesPostsForTests();
  });

  it("fetches once and memoises across repeated calls", async () => {
    fetchMock.mockResolvedValue(okJson({ posts: SAMPLE }));

    const first = await loadTimesPosts();
    const second = await loadTimesPosts();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(SAMPLE);
    expect(second).toEqual(SAMPLE);
  });

  it("resolves [] on a rejected fetch", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    await expect(loadTimesPosts()).resolves.toEqual([]);
  });

  it("resolves [] on a non-JSON body", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new Error("Unexpected token < in JSON"))
    });

    await expect(loadTimesPosts()).resolves.toEqual([]);
  });

  it("resolves [] when the response is not ok, without touching the body", async () => {
    const json = vi.fn();
    fetchMock.mockResolvedValue({ ok: false, json });

    await expect(loadTimesPosts()).resolves.toEqual([]);
    expect(json).not.toHaveBeenCalled();
  });

  it("does not poison the memo permanently — a reset after a failure lets the next call retry", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await expect(loadTimesPosts()).resolves.toEqual([]);

    __resetTimesPostsForTests();
    fetchMock.mockResolvedValueOnce(okJson({ posts: SAMPLE }));

    await expect(loadTimesPosts()).resolves.toEqual(SAMPLE);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
