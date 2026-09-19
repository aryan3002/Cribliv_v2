import { describe, expect, it, vi } from "vitest";

import type { DatabaseService } from "../../common/database.service";
import { runPgRentSweep } from "../pg-rent-sweeps";

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
