import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchApi } from "../api";

type FetchInit = RequestInit & { next?: { revalidate?: number } };

const okResponse = (data: unknown) =>
  ({ ok: true, json: async () => ({ data }) }) as unknown as Response;

function spyFetch() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse({ ok: 1 }));
}

function initOf(spy: ReturnType<typeof spyFetch>): FetchInit {
  return spy.mock.calls[0]?.[1] as FetchInit;
}

describe("fetchApi cache strategy", () => {
  afterEach(() => vi.restoreAllMocks());

  it("ISR-caches the fetch (next.revalidate, NOT no-store) when opts.revalidate is set", async () => {
    const fetchSpy = spyFetch();

    await fetchApi("/pg/listings", undefined, { revalidate: 3600 });

    const init = initOf(fetchSpy);
    // The whole point of the fix: a static SEO page's server fetch must be
    // cacheable so the route stays static/ISR instead of going dynamic.
    expect(init.next).toEqual({ revalidate: 3600 });
    expect(init.cache).toBeUndefined();
  });

  it("uses cache:no-store (dynamic) when only opts.server is set", async () => {
    const fetchSpy = spyFetch();

    await fetchApi("/pg/listings", undefined, { server: true });

    const init = initOf(fetchSpy);
    expect(init.cache).toBe("no-store");
    expect(init.next).toBeUndefined();
  });

  it("prefers ISR revalidate over no-store when both are passed", async () => {
    const fetchSpy = spyFetch();

    await fetchApi("/pg/listings", undefined, { server: true, revalidate: 3600 });

    const init = initOf(fetchSpy);
    expect(init.next).toEqual({ revalidate: 3600 });
    expect(init.cache).toBeUndefined();
  });
});
