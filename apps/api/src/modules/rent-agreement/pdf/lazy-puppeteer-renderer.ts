// Lazy wrapper around PuppeteerPdfRenderer.
//
// Chromium is launched on the FIRST render() call, not at API boot. A missing
// or broken Chromium therefore only fails the individual PDF job (job status →
// render error) instead of crashing the whole API process at startup.

import type { PdfRendererPort, RenderInput } from "./pdf-renderer.port";
import { BrowserPool } from "./browser-pool";
import { PuppeteerPdfRenderer } from "./puppeteer-pdf-renderer";

const DEFAULT_MAX_PAGES_PER_BROWSER = 50;

export class LazyPuppeteerPdfRenderer implements PdfRendererPort {
  private inner: PuppeteerPdfRenderer | null = null;
  private launching: Promise<PuppeteerPdfRenderer> | null = null;

  constructor(private readonly maxPagesPerBrowser: number = DEFAULT_MAX_PAGES_PER_BROWSER) {}

  private getRenderer(): Promise<PuppeteerPdfRenderer> {
    if (this.inner) return Promise.resolve(this.inner);
    if (!this.launching) {
      this.launching = (async () => {
        const pool = new BrowserPool({ maxPagesPerBrowser: this.maxPagesPerBrowser });
        await pool.launch();
        this.inner = new PuppeteerPdfRenderer({ pool });
        return this.inner;
      })();
    }
    return this.launching;
  }

  async render(input: RenderInput): Promise<Buffer> {
    const renderer = await this.getRenderer();
    return renderer.render(input);
  }
}
