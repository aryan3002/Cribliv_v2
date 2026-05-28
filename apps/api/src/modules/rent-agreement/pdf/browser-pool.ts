// Browser pool for PDF rendering. Single shared Puppeteer browser; pages created
// on demand. Browser recycled after RENT_AGREEMENT_PDF_MAX_PAGES_PER_BROWSER
// generations (default 50). Phase 13 wires the SIGTERM handler into the worker
// process. Phase 14 smoke-tests with real Chromium.
//
// Spec: [[PDF-Pipeline]] §Browser pool
// Flags: --no-sandbox --disable-dev-shm-usage --disable-gpu (container best-practice)

import puppeteer from "puppeteer";
import type { Browser, Page } from "puppeteer";

export type BrowserPoolErrorCode = "RENT_AGREEMENT_PDF_POOL_NOT_LAUNCHED";

export class BrowserPoolError extends Error {
  readonly code: BrowserPoolErrorCode;
  constructor(code: BrowserPoolErrorCode, message: string) {
    super(message);
    this.name = "BrowserPoolError";
    this.code = code;
  }
}

interface BrowserPoolOptions {
  maxPagesPerBrowser: number;
}

export class BrowserPool {
  private readonly maxPages: number;
  private browser: Browser | null = null;
  private available: Page[] = [];
  private inUse = new Set<Page>();
  private generations = 0;

  constructor(opts: BrowserPoolOptions) {
    this.maxPages = opts.maxPagesPerBrowser;
  }

  /** Launch the shared browser. Must be called before acquire(). */
  async launch(): Promise<void> {
    this.browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
    });
    this.generations = 0;
    this.available = [];
    this.inUse.clear();
  }

  /**
   * Acquire a page from the pool. If a recycled page is available, return it.
   * Otherwise create a new page. Throws if the pool has not been launched.
   */
  async acquire(): Promise<Page> {
    if (!this.browser) {
      throw new BrowserPoolError(
        "RENT_AGREEMENT_PDF_POOL_NOT_LAUNCHED",
        "BrowserPool not launched"
      );
    }

    // Check if browser needs recycling
    if (this.generations >= this.maxPages) {
      await this.recycleBrowser();
    }

    const existing = this.available.pop();
    if (existing) {
      this.inUse.add(existing);
      return existing;
    }

    const page = await this.browser!.newPage();
    this.inUse.add(page);
    return page;
  }

  /**
   * Release a page back to the pool. Resets the page to about:blank so
   * no stale content leaks between renders.
   */
  async release(page: Page): Promise<void> {
    this.inUse.delete(page);
    this.generations += 1;
    try {
      await page.goto("about:blank");
      this.available.push(page);
    } catch {
      // Page is broken — close it and don't return to pool
      try {
        await page.close();
      } catch {
        /* ignore */
      }
    }
  }

  /** Number of pages generated since last browser recycle. */
  get generationCount(): number {
    return this.generations;
  }

  /** Gracefully shut down: close all pages, then the browser. */
  async shutdown(): Promise<void> {
    // Close in-use pages
    for (const page of this.inUse) {
      try {
        await page.close();
      } catch {
        /* ignore */
      }
    }
    this.inUse.clear();

    // Close available (pooled) pages
    for (const page of this.available) {
      try {
        await page.close();
      } catch {
        /* ignore */
      }
    }
    this.available = [];

    // Close browser
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        /* ignore */
      }
      this.browser = null;
    }

    this.generations = 0;
  }

  /** Recycle the browser: close old one, launch new one. */
  private async recycleBrowser(): Promise<void> {
    const oldBrowser = this.browser;

    // Close all pooled pages
    for (const page of this.available) {
      try {
        await page.close();
      } catch {
        /* ignore */
      }
    }
    this.available = [];

    // Close any pages still in flight (concurrent acquires whose release hasn't fired).
    // They belong to the old browser and would orphan otherwise. Their pending release()
    // calls will encounter a closed page; release()'s catch+close path handles that.
    for (const page of this.inUse) {
      try {
        await page.close();
      } catch {
        /* ignore */
      }
    }
    this.inUse.clear();

    // Launch new browser first (so acquire can succeed)
    this.browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
    });
    this.generations = 0;

    // Close old browser
    if (oldBrowser) {
      try {
        await oldBrowser.close();
      } catch {
        /* ignore */
      }
    }
  }
}
