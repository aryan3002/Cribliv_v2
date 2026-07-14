import { describe, it, expect, vi } from "vitest";
import { AdminLeadsController } from "../admin-leads.controller";

/**
 * The board route forwards each query param explicitly, so a param that isn't
 * listed is silently dropped before it reaches sanitizeBoardParams. This guards
 * the `sort` wiring specifically — the "Newest first" toggle was a no-op because
 * the controller never passed `sort` through.
 */
function makeController(getBoard: ReturnType<typeof vi.fn>) {
  const ops = { getBoard } as any;
  const leads = {} as any;
  return new AdminLeadsController(leads, ops);
}

describe("AdminLeadsController.board query wiring", () => {
  const emptyBoard = { rows: [], total: 0, generated_at: "", counters: {} };

  it("forwards the sort param through to getBoard", async () => {
    const getBoard = vi.fn().mockResolvedValue(emptyBoard);
    const controller = makeController(getBoard);

    // board(filter, ownerId, state, status, q, range, sort, page, pageSize)
    await controller.board("all", undefined, undefined, undefined, undefined, undefined, "newest");

    expect(getBoard).toHaveBeenCalledWith(
      expect.objectContaining({ filter: "all", sort: "newest" })
    );
  });

  it("defaults sort to 'urgency' when the param is absent", async () => {
    const getBoard = vi.fn().mockResolvedValue(emptyBoard);
    const controller = makeController(getBoard);

    await controller.board("all");

    expect(getBoard).toHaveBeenCalledWith(expect.objectContaining({ sort: "urgency" }));
  });
});
