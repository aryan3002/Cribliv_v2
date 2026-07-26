import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  getShortlistCount,
  subscribeShortlistCount,
  refreshShortlistCount,
  adjustShortlistCount,
  __resetShortlistCountForTests
} from "../shortlist-count";

// This repo's Vitest/jsdom environment leaves `window.localStorage` undefined
// (see the guard comment in `lib/client-auth.ts`) rather than providing a real
// Storage — Node's own experimental global `localStorage` shadows jsdom's.
// Install a minimal in-memory Storage so `readGuestShortlist()` (used by
// `refreshShortlistCount`) has something real to read from. Same pattern as
// `components/__tests__/welcome-credits-modal.test.tsx`.
function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
    clear: () => values.clear(),
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    }
  };
}

function installLocalStorage() {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: createStorage()
  });
}

describe("shortlist count store", () => {
  beforeEach(() => {
    installLocalStorage();
    __resetShortlistCountForTests();
    window.localStorage.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("starts undetermined", () => {
    expect(getShortlistCount()).toBeNull();
  });

  it("seeds from localStorage for guests", async () => {
    window.localStorage.setItem("cribliv:guest-shortlist", JSON.stringify(["a", "b"]));
    await refreshShortlistCount(null);
    expect(getShortlistCount()).toBe(2);
  });

  it("notifies subscribers on change", async () => {
    const seen: (number | null)[] = [];
    const unsub = subscribeShortlistCount((n) => seen.push(n));
    window.localStorage.setItem("cribliv:guest-shortlist", JSON.stringify(["a"]));
    await refreshShortlistCount(null);
    expect(seen).toContain(1);
    unsub();
  });

  it("stops notifying after unsubscribe", async () => {
    const seen: (number | null)[] = [];
    const unsub = subscribeShortlistCount((n) => seen.push(n));
    unsub();
    window.localStorage.setItem("cribliv:guest-shortlist", JSON.stringify(["a"]));
    await refreshShortlistCount(null);
    expect(seen).toEqual([]);
  });

  it("adjusts optimistically without a refetch", async () => {
    window.localStorage.setItem("cribliv:guest-shortlist", JSON.stringify(["a"]));
    await refreshShortlistCount(null);
    adjustShortlistCount(1);
    expect(getShortlistCount()).toBe(2);
    adjustShortlistCount(-1);
    expect(getShortlistCount()).toBe(1);
  });

  it("never goes below zero", async () => {
    window.localStorage.setItem("cribliv:guest-shortlist", JSON.stringify([]));
    await refreshShortlistCount(null);
    adjustShortlistCount(-5);
    expect(getShortlistCount()).toBe(0);
  });

  it("ignores an adjust while still undetermined", () => {
    adjustShortlistCount(1);
    expect(getShortlistCount()).toBeNull();
  });

  it("stays undetermined when the logged-in fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    await refreshShortlistCount("acc_token");
    expect(getShortlistCount()).toBeNull();
  });
});
