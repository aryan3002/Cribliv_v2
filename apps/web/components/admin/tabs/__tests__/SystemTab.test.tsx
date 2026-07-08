import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/admin-api", () => ({
  adjustAdminWallet: vi.fn(),
  triggerAiBackfill: vi.fn(),
  triggerAiRecomputeScores: vi.fn()
}));

import { SystemTab } from "../SystemTab";
import { triggerAiBackfill, triggerAiRecomputeScores } from "../../../../lib/admin-api";

const mockedBackfill = vi.mocked(triggerAiBackfill);
const mockedRecompute = vi.mocked(triggerAiRecomputeScores);

describe("SystemTab", () => {
  const onToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the embedding backfill count in the toast and inline status", async () => {
    mockedBackfill.mockResolvedValueOnce({ backfilled: 14 });

    render(<SystemTab accessToken="tok" onToast={onToast} />);
    fireEvent.click(screen.getByRole("button", { name: /run backfill/i }));

    await waitFor(() => {
      expect(onToast).toHaveBeenCalledWith("Backfill complete: 14 listings embedded", "trust");
    });
    expect(screen.getByText("Last run")).toBeInTheDocument();
    expect(screen.getByText("14 listings embedded")).toBeInTheDocument();
  });

  it("shows the score recompute count in the toast and inline status", async () => {
    mockedRecompute.mockResolvedValueOnce({ recomputed: 500 });

    render(<SystemTab accessToken="tok" onToast={onToast} />);
    fireEvent.click(screen.getByRole("button", { name: /recompute scores/i }));

    await waitFor(() => {
      expect(onToast).toHaveBeenCalledWith("Scores recomputed: 500 listings", "trust");
    });
    expect(screen.getByText("Last run")).toBeInTheDocument();
    expect(screen.getByText("500 listings recomputed")).toBeInTheDocument();
  });
});
