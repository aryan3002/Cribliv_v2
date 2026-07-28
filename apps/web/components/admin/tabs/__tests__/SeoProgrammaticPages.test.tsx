import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/admin-api", () => ({
  listSeoCities: vi.fn(),
  setSeoCityEnabled: vi.fn(),
  // Also imported transitively by SeoCityReviewDrawer; stubbed so a future
  // test that opens the drawer doesn't hit an undefined fetcher.
  listCityLocalities: vi.fn(),
  listCityLandmarks: vi.fn(),
  listCityMetro: vi.fn()
}));

import { SeoProgrammaticPages } from "../SeoProgrammaticPages";
import { listSeoCities, setSeoCityEnabled } from "../../../../lib/admin-api";
import type { SeoCityConfigVm } from "../../../../lib/admin-api";

const mockedList = vi.mocked(listSeoCities);
const mockedToggle = vi.mocked(setSeoCityEnabled);

const ROWS: SeoCityConfigVm[] = [
  {
    citySlug: "lucknow",
    nameEn: "Lucknow",
    programmaticEnabled: true,
    localityCount: 26,
    landmarkCount: 12,
    metroCount: 21,
    indexableCount: 18,
    thinCount: 5,
    enabledAt: "2026-07-03T00:00:00.000Z",
    notes: "reference",
    updatedAt: "2026-07-03T01:00:00.000Z"
  },
  {
    citySlug: "noida",
    nameEn: "Noida",
    programmaticEnabled: false,
    localityCount: 28,
    landmarkCount: 14,
    metroCount: 8,
    indexableCount: 16,
    thinCount: 100,
    enabledAt: null,
    notes: null,
    updatedAt: "2026-07-03T02:00:00.000Z"
  }
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SeoProgrammaticPages", () => {
  it("headline counts only LIVE cities, not drafts", async () => {
    mockedList.mockResolvedValueOnce(ROWS);

    render(<SeoProgrammaticPages accessToken="tok" onToast={vi.fn()} />);
    await screen.findByText("Lucknow");

    // Lucknow is live (18 indexable / 5 thin); Noida is draft (16 / 100) and its
    // pages 404, so it must not inflate either headline. Summing every row is
    // what made the old "Indexable" card describe pages nobody can reach.
    const grid = document.querySelector(".admin-stat-grid") as HTMLElement;
    expect(grid).toBeTruthy();
    expect(grid.textContent).toContain("18");
    expect(grid.textContent).toContain("5");
    expect(grid.textContent).not.toContain("34");
    expect(grid.textContent).not.toContain("105");
  });

  it("renders one row per city with counts", async () => {
    mockedList.mockResolvedValueOnce(ROWS);

    render(<SeoProgrammaticPages accessToken="tok" onToast={vi.fn()} />);

    expect(await screen.findByText("Lucknow")).toBeInTheDocument();
    expect(screen.getByText("Noida")).toBeInTheDocument();
    expect(screen.getByText("26")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("21")).toBeInTheDocument();
    expect(screen.getByText("16")).toBeInTheDocument();
  });

  it("enables a draft city and fires a toast", async () => {
    mockedList.mockResolvedValueOnce(ROWS);
    mockedToggle.mockResolvedValueOnce({
      ...ROWS[1],
      programmaticEnabled: true,
      enabledAt: "2026-07-03T03:00:00.000Z"
    });
    const onToast = vi.fn();

    render(<SeoProgrammaticPages accessToken="tok" onToast={onToast} />);

    fireEvent.click(await screen.findByRole("button", { name: "Enable Noida" }));

    await waitFor(() => {
      expect(mockedToggle).toHaveBeenCalledWith("tok", "noida", true, undefined);
    });
    expect(onToast).toHaveBeenCalledWith("Noida enabled", "trust");
    expect(await screen.findByRole("button", { name: "Disable Noida" })).toBeInTheDocument();
  });

  it("renders an empty state when no city configs exist", async () => {
    mockedList.mockResolvedValueOnce([]);

    render(<SeoProgrammaticPages accessToken="tok" onToast={vi.fn()} />);

    expect(await screen.findByText("No cities configured")).toBeInTheDocument();
  });
});
