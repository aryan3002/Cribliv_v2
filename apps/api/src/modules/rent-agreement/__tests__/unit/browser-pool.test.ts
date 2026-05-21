import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock puppeteer before importing the SUT
vi.mock("puppeteer", () => {
  return {
    default: {
      launch: vi.fn()
    }
  };
});

import puppeteer from "puppeteer";
import { BrowserPool } from "../../pdf/browser-pool";

// ---------------------------------------------------------------------------
// Helpers: create realistic mock Browser and Page objects
// ---------------------------------------------------------------------------

function makeMockPage() {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    setContent: vi.fn().mockResolvedValue(undefined),
    pdf: vi.fn().mockResolvedValue(Buffer.from("fake-pdf")),
    close: vi.fn().mockResolvedValue(undefined),
    isClosed: vi.fn().mockReturnValue(false)
  };
}

function makeMockBrowser(pages?: ReturnType<typeof makeMockPage>[]) {
  const pageQueue = pages ?? [makeMockPage()];
  let pageIndex = 0;
  return {
    newPage: vi.fn(async () => {
      if (pageIndex < pageQueue.length) return pageQueue[pageIndex++];
      return makeMockPage();
    }),
    close: vi.fn().mockResolvedValue(undefined),
    process: vi.fn().mockReturnValue({ pid: 12345 })
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  // Ensure no dangling pool instances
});

describe("BrowserPool", () => {
  describe("launch", () => {
    it("calls puppeteer.launch with no-sandbox flags", async () => {
      const mockBrowser = makeMockBrowser();
      vi.mocked(puppeteer.launch).mockResolvedValue(mockBrowser as any);

      const pool = new BrowserPool({ maxPagesPerBrowser: 50 });
      await pool.launch();

      expect(puppeteer.launch).toHaveBeenCalledTimes(1);
      expect(puppeteer.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          args: expect.arrayContaining(["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"])
        })
      );

      await pool.shutdown();
    });
  });

  describe("acquire / release cycle", () => {
    it("acquire returns a page; release resets it to about:blank", async () => {
      const mockPage = makeMockPage();
      const mockBrowser = makeMockBrowser([mockPage]);
      vi.mocked(puppeteer.launch).mockResolvedValue(mockBrowser as any);

      const pool = new BrowserPool({ maxPagesPerBrowser: 50 });
      await pool.launch();

      const page = await pool.acquire();
      expect(page).toBe(mockPage);
      expect(mockBrowser.newPage).toHaveBeenCalledTimes(1);

      await pool.release(page);
      expect(mockPage.goto).toHaveBeenCalledWith("about:blank");
    });

    it("a released page can be reacquired without creating a new one", async () => {
      const mockPage = makeMockPage();
      const mockBrowser = makeMockBrowser([mockPage]);
      vi.mocked(puppeteer.launch).mockResolvedValue(mockBrowser as any);

      const pool = new BrowserPool({ maxPagesPerBrowser: 50 });
      await pool.launch();

      const p1 = await pool.acquire();
      await pool.release(p1);
      const p2 = await pool.acquire();
      expect(p2).toBe(p1);
      expect(mockBrowser.newPage).toHaveBeenCalledTimes(1);

      await pool.release(p2);
      await pool.shutdown();
    });
  });

  describe("page generation counter + browser recycle", () => {
    it("recycles the browser after maxPagesPerBrowser generations", async () => {
      const maxPages = 3;
      const mockBrowser1 = makeMockBrowser();
      const mockBrowser2 = makeMockBrowser();
      vi.mocked(puppeteer.launch)
        .mockResolvedValueOnce(mockBrowser1 as any)
        .mockResolvedValueOnce(mockBrowser2 as any);

      const pool = new BrowserPool({ maxPagesPerBrowser: maxPages });
      await pool.launch();

      // Generate maxPages PDFs (acquire+release = 1 generation each)
      for (let i = 0; i < maxPages; i++) {
        const page = await pool.acquire();
        await pool.release(page);
      }

      // Next acquire should trigger recycle
      const nextPage = await pool.acquire();
      expect(puppeteer.launch).toHaveBeenCalledTimes(2);
      expect(mockBrowser1.close).toHaveBeenCalledTimes(1);

      await pool.release(nextPage);
      await pool.shutdown();
    });

    it("closes pooled (available) pages when recycling the browser", async () => {
      const maxPages = 2;
      const p1 = makeMockPage();
      const mockBrowser1 = makeMockBrowser([p1]);
      const mockBrowser2 = makeMockBrowser();
      vi.mocked(puppeteer.launch)
        .mockResolvedValueOnce(mockBrowser1 as any)
        .mockResolvedValueOnce(mockBrowser2 as any);

      const pool = new BrowserPool({ maxPagesPerBrowser: maxPages });
      await pool.launch();

      // Single page reused via LIFO pop — after 2 release cycles it's in `available`.
      const a = await pool.acquire();
      await pool.release(a);
      const b = await pool.acquire();
      await pool.release(b);
      // Trigger recycle
      const c = await pool.acquire();

      // The pooled page from the old browser should be closed during recycle.
      expect(p1.close).toHaveBeenCalled();

      await pool.release(c);
      await pool.shutdown();
    });

    it("closes inUse pages (concurrent acquires) when recycling the browser — no orphan leak", async () => {
      const maxPages = 3;
      const heldPage = makeMockPage(); // will be held in inUse across recycle
      const cyclePage = makeMockPage(); // recycled through available between operations
      const freshPage = makeMockPage(); // from the new browser
      const mockBrowser1 = makeMockBrowser([heldPage, cyclePage]);
      const mockBrowser2 = makeMockBrowser([freshPage]);
      vi.mocked(puppeteer.launch)
        .mockResolvedValueOnce(mockBrowser1 as any)
        .mockResolvedValueOnce(mockBrowser2 as any);

      const pool = new BrowserPool({ maxPagesPerBrowser: maxPages });
      await pool.launch();

      // Acquire and HOLD heldPage; never release it.
      const held = await pool.acquire();
      expect(held).toBe(heldPage);

      // Cycle a second page maxPages times to reach the recycle threshold.
      for (let i = 0; i < maxPages; i++) {
        const p = await pool.acquire();
        await pool.release(p);
      }

      // Next acquire triggers recycle while heldPage is still in inUse.
      const fresh = await pool.acquire();
      expect(fresh).toBe(freshPage);

      // The held page from the old browser MUST be closed — otherwise it's an orphan.
      expect(heldPage.close).toHaveBeenCalled();

      await pool.release(fresh);
      await pool.shutdown();
    });
  });

  describe("shutdown", () => {
    it("closes all pages then the browser", async () => {
      const mockPage = makeMockPage();
      const mockBrowser = makeMockBrowser([mockPage]);
      vi.mocked(puppeteer.launch).mockResolvedValue(mockBrowser as any);

      const pool = new BrowserPool({ maxPagesPerBrowser: 50 });
      await pool.launch();

      const page = await pool.acquire();
      // Don't release — shutdown should close it
      await pool.shutdown();

      expect(mockPage.close).toHaveBeenCalledTimes(1);
      expect(mockBrowser.close).toHaveBeenCalledTimes(1);
    });

    it("calling shutdown on an unlaunched pool does not throw", async () => {
      const pool = new BrowserPool({ maxPagesPerBrowser: 50 });
      await expect(pool.shutdown()).resolves.toBeUndefined();
    });
  });

  describe("acquire before launch throws", () => {
    it("throws if pool has not been launched", async () => {
      const pool = new BrowserPool({ maxPagesPerBrowser: 50 });
      await expect(pool.acquire()).rejects.toThrow("not launched");
    });

    it("typed error carries RENT_AGREEMENT_PDF_POOL_NOT_LAUNCHED code", async () => {
      const pool = new BrowserPool({ maxPagesPerBrowser: 50 });
      try {
        await pool.acquire();
        throw new Error("should not reach");
      } catch (err) {
        expect((err as { code?: string }).code).toBe("RENT_AGREEMENT_PDF_POOL_NOT_LAUNCHED");
      }
    });
  });

  describe("generation count", () => {
    it("exposes the number of pages generated since last browser recycle", async () => {
      const mockBrowser = makeMockBrowser();
      vi.mocked(puppeteer.launch).mockResolvedValue(mockBrowser as any);

      const pool = new BrowserPool({ maxPagesPerBrowser: 50 });
      await pool.launch();
      expect(pool.generationCount).toBe(0);

      const p1 = await pool.acquire();
      await pool.release(p1);
      expect(pool.generationCount).toBe(1);

      const p2 = await pool.acquire();
      await pool.release(p2);
      expect(pool.generationCount).toBe(2);

      await pool.shutdown();
    });
  });
});
