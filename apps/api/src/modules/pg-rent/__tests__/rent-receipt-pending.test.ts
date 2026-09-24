import { describe, expect, it, vi } from "vitest";

import type { DatabaseService } from "../../../common/database.service";
import type { PdfStoragePort } from "../../rent-agreement/pdf/pdf-storage.port";
import type { SasIssuerPort } from "../../rent-agreement/downloads/sas-issuer.port";
import { RentReceiptService } from "../services/rent-receipt.service";

/**
 * Important 7 (fix round 1): renderPending()'s sole caller is the worker
 * sweep, and nothing exercised its own batch-loop logic in isolation — the
 * DB-backed rent-receipt-queue.integration.test.ts only ever drove it via
 * scoped renderOne(receiptId) calls (Claim C's determinism fix), which never
 * reaches renderPending()'s `limit`, break-on-skip, or {rendered, failed}
 * accounting. renderPending() never touches db/renderer/storage/sas
 * directly — it delegates entirely to this.renderOne(), so stubbing that one
 * method is enough to unit-test the loop with no DB at all.
 */
function service(): RentReceiptService {
  return new RentReceiptService(
    {} as DatabaseService,
    { render: vi.fn() },
    { upload: vi.fn() } as unknown as PdfStoragePort,
    { issue: vi.fn() } as unknown as SasIssuerPort
  );
}

describe("RentReceiptService.renderPending", () => {
  it("counts ready and failed separately", async () => {
    const svc = service();
    const renderOne = vi
      .spyOn(svc, "renderOne")
      .mockResolvedValueOnce("ready")
      .mockResolvedValueOnce("failed")
      .mockResolvedValueOnce("ready");
    await expect(svc.renderPending(3)).resolves.toEqual({ rendered: 2, failed: 1 });
    expect(renderOne).toHaveBeenCalledTimes(3);
  });

  it("breaks on the first 'skipped' — a transient (non-terminal) failure — without exhausting the limit", async () => {
    const svc = service();
    const renderOne = vi
      .spyOn(svc, "renderOne")
      .mockResolvedValueOnce("ready")
      .mockResolvedValueOnce("skipped")
      .mockResolvedValueOnce("ready"); // must never be reached
    await expect(svc.renderPending(20)).resolves.toEqual({ rendered: 1, failed: 0 });
    expect(renderOne).toHaveBeenCalledTimes(2);
  });

  it("returns zero/zero immediately when nothing is eligible to claim", async () => {
    const svc = service();
    const renderOne = vi.spyOn(svc, "renderOne").mockResolvedValueOnce("skipped");
    await expect(svc.renderPending()).resolves.toEqual({ rendered: 0, failed: 0 });
    expect(renderOne).toHaveBeenCalledTimes(1);
  });

  it("stops at the configured limit even when every attempt succeeds", async () => {
    const svc = service();
    const renderOne = vi.spyOn(svc, "renderOne").mockResolvedValue("ready");
    await expect(svc.renderPending(5)).resolves.toEqual({ rendered: 5, failed: 0 });
    expect(renderOne).toHaveBeenCalledTimes(5);
  });

  it("defaults the limit to 20", async () => {
    const svc = service();
    const renderOne = vi.spyOn(svc, "renderOne").mockResolvedValue("ready");
    await expect(svc.renderPending()).resolves.toEqual({ rendered: 20, failed: 0 });
    expect(renderOne).toHaveBeenCalledTimes(20);
  });

  it("calls renderOne unscoped (no receiptId) for the worker's batch drain", async () => {
    const svc = service();
    const renderOne = vi.spyOn(svc, "renderOne").mockResolvedValueOnce("skipped");
    await svc.renderPending();
    expect(renderOne).toHaveBeenCalledWith();
  });
});
