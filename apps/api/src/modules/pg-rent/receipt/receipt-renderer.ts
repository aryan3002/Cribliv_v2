import { readFileSync } from "node:fs";
import path from "node:path";
import Handlebars from "handlebars";

import { BrowserPool } from "../../rent-agreement/pdf/browser-pool";
import type { ReceiptSnapshot } from "../services/rent-receipt.service";

export interface ReceiptRendererPort {
  render(snapshot: ReceiptSnapshot, locale: "en" | "hi", voided: boolean): Promise<Buffer>;
}

const templates: Record<"en" | "hi", HandlebarsTemplateDelegate> = {
  en: Handlebars.compile(readFileSync(path.join(__dirname, "templates", "receipt.en.hbs"), "utf8")),
  hi: Handlebars.compile(readFileSync(path.join(__dirname, "templates", "receipt.hi.hbs"), "utf8"))
};

/** en-IN grouping: 12,34,567 */
export function formatInr(n: number): string {
  return `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n)}`;
}

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  card: "Card",
  gateway: "Online",
  deposit: "Deposit",
  other: "Other"
};

/** Pure: snapshot → HTML. Handlebars escapes every `{{ }}` field, so owner-typed text is safe. */
export function renderReceiptHtml(
  snapshot: ReceiptSnapshot,
  locale: "en" | "hi",
  voided: boolean
): string {
  return templates[locale]({
    ...snapshot,
    voided,
    amount: formatInr(snapshot.amount_inr),
    credit: snapshot.credit_inr > 0 ? formatInr(snapshot.credit_inr) : null,
    method_label: METHOD_LABEL[snapshot.method] ?? snapshot.method,
    covers: snapshot.covers.map((c) => ({
      ...c,
      allocated: formatInr(c.allocated_inr),
      remaining: c.remaining_inr > 0 ? formatInr(c.remaining_inr) : null
    }))
  });
}

export class LazyReceiptRenderer implements ReceiptRendererPort {
  private pool: BrowserPool | null = null;
  private launching: Promise<BrowserPool> | null = null;

  private getPool(): Promise<BrowserPool> {
    if (this.pool) return Promise.resolve(this.pool);
    if (!this.launching) {
      this.launching = (async () => {
        const pool = new BrowserPool({ maxPagesPerBrowser: 50 });
        await pool.launch();
        this.pool = pool;
        return pool;
      })();
    }
    return this.launching;
  }

  async render(snapshot: ReceiptSnapshot, locale: "en" | "hi", voided: boolean): Promise<Buffer> {
    const pool = await this.getPool();
    const page = await pool.acquire();
    try {
      await page.setContent(renderReceiptHtml(snapshot, locale, voided), { waitUntil: "load" });
      const pdf = await page.pdf({
        format: "A5",
        printBackground: true,
        margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" }
      });
      return Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
    } finally {
      await pool.release(page);
    }
  }
}
