import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { TrendPoint } from "@cribliv/shared-types";

vi.mock("recharts", async (orig) => {
  const actual = await orig<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
  };
});

import { PortfolioTrendChart } from "../PortfolioTrendChart";

const trend: TrendPoint[] = Array.from({ length: 30 }, (_, i) => ({
  day: `2026-05-${String(i + 1).padStart(2, "0")}`,
  appearances: i,
  clicks: 0,
  views: 0,
  leads: 0
}));

describe("PortfolioTrendChart", () => {
  it("shows all 30 points by default", () => {
    render(<PortfolioTrendChart trend={trend} />);
    expect(screen.getByTestId("trend-point-count").textContent).toBe("30");
  });

  it("slices to the last 7 points when 7d is selected", () => {
    render(<PortfolioTrendChart trend={trend} />);
    fireEvent.click(screen.getByRole("button", { name: "7d" }));
    expect(screen.getByTestId("trend-point-count").textContent).toBe("7");
  });

  it("does not crash on an empty trend", () => {
    expect(() => render(<PortfolioTrendChart trend={[]} />)).not.toThrow();
  });
});
