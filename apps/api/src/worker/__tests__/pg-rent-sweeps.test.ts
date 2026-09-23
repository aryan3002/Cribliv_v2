import { describe, expect, it, vi } from "vitest";

import type { DatabaseService } from "../../common/database.service";
import { receiptServiceFromEnv, runPgRentSweep } from "../pg-rent-sweeps";

describe("runPgRentSweep", () => {
  it("returns zeros without a database", async () => {
    const db = { isEnabled: () => false } as DatabaseService;
    await expect(runPgRentSweep(db, "2026-09-17")).resolves.toEqual({
      properties: 0,
      invoices: 0,
      drafts: 0,
      deposits: 0
    });
  });

  it("sums per-property results and survives one property failing", async () => {
    const db = {
      isEnabled: () => true,
      query: vi.fn().mockResolvedValue({
        rows: [{ pg_property_id: "p1" }, { pg_property_id: "p2" }, { pg_property_id: "p3" }]
      }),
      getClient: vi.fn()
    } as unknown as DatabaseService;
    const generate = vi
      .fn()
      .mockResolvedValueOnce({
        invoices_created: 2,
        drafts_created: 1,
        deposits_created: 1,
        skipped: []
      })
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({
        invoices_created: 1,
        drafts_created: 0,
        deposits_created: 0,
        skipped: []
      });
    const result = await runPgRentSweep(db, "2026-09-17", {
      generateInvoicesForProperty: generate
    });
    expect(result).toEqual({ properties: 3, invoices: 3, drafts: 1, deposits: 1 });
    expect(generate).toHaveBeenCalledTimes(3);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("paused_at IS NULL"), []);
  });
});

describe("receiptServiceFromEnv", () => {
  it("memoises the default receipt service across calls (Critical 2, fix round 1)", () => {
    // Before this fix, runPgRentReceiptSweep constructed
    // `new RentReceiptService(db, new LazyReceiptRenderer(), ...)` fresh on
    // every call — since LazyReceiptRenderer launches a real Chromium via
    // BrowserPool on its first render() and exposes no dispose(), any
    // worker tick that rendered ≥1 receipt orphaned a browser process. This
    // is the cheapest possible proof of the fix: the same module-scoped
    // instance (and therefore the same LazyReceiptRenderer, launched at most
    // once) comes back on every call, regardless of how many times the
    // worker's 2-minute setInterval fires.
    const db = { isEnabled: () => true } as DatabaseService;
    const first = receiptServiceFromEnv(db);
    const second = receiptServiceFromEnv(db);
    const third = receiptServiceFromEnv(db);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });
});
