import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PgDashboardListingHealth } from "@cribliv/shared-types";

// recharts needs a sized container in jsdom — stub ResponsiveContainer to render children.
vi.mock("recharts", async (orig) => {
  const actual = await orig<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
  };
});

import { ListingFunnel } from "../ListingFunnel";

function make(over: Partial<PgDashboardListingHealth> = {}): PgDashboardListingHealth {
  return {
    listing_id: "L1",
    status: "active",
    views_7d: 12,
    contact_unlocks_7d: 2,
    search_appearances_7d: 142,
    ctr_7d: 0.084,
    interest_rate_7d: 0.167,
    trend_7d: Array.from({ length: 7 }, (_, i) => ({
      day: `2026-05-2${i}`,
      appearances: i,
      clicks: 0,
      views: 0,
      leads: 0
    })),
    last_updated: "2026-05-31T00:00:00Z",
    ...over
  };
}

describe("ListingFunnel", () => {
  it("renders appearances, CTR%, views, interest%, leads", () => {
    render(<ListingFunnel data={make()} />);
    expect(screen.getByText("142")).toBeTruthy();
    expect(screen.getByText("8.4%")).toBeTruthy(); // ctr 0.084
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("16.7%")).toBeTruthy(); // interest 0.167
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("shows - for CTR when there are no appearances (no-data vs true 0%)", () => {
    render(<ListingFunnel data={make({ search_appearances_7d: 0, ctr_7d: 0 })} />);
    expect(screen.getAllByText("-").length).toBeGreaterThan(0);
  });

  it("shows - for interest rate when there are no views", () => {
    render(<ListingFunnel data={make({ views_7d: 0, interest_rate_7d: 0 })} />);
    expect(screen.getAllByText("-").length).toBeGreaterThan(0);
  });

  it("renders the trend sparkline without crashing on all-zero data", () => {
    const zero = make({
      trend_7d: Array.from({ length: 7 }, (_, i) => ({
        day: `d${i}`,
        appearances: 0,
        clicks: 0,
        views: 0,
        leads: 0
      }))
    });
    expect(() => render(<ListingFunnel data={zero} />)).not.toThrow();
  });
});
