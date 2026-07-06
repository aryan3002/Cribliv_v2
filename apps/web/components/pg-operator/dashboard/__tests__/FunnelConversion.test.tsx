import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PgPortfolioSummary } from "@cribliv/shared-types";
import { FunnelConversion } from "../FunnelConversion";

function make(over: Partial<PgPortfolioSummary> = {}): PgPortfolioSummary {
  return {
    appearances: 100,
    clicks: 50,
    views: 40,
    leads: 4,
    ctr: 0.5,
    interest_rate: 0.1,
    conversion: 0.04,
    deltas: { appearances: null, views: null, leads: null },
    ...over
  };
}

describe("FunnelConversion", () => {
  it("renders the four funnel stages with counts", () => {
    render(<FunnelConversion portfolio={make()} deals={0} />);
    expect(screen.getByText("Appearances")).toBeTruthy();
    expect(screen.getByText("Views")).toBeTruthy();
    expect(screen.getByText("Leads")).toBeTruthy();
    expect(screen.getByText("Deals")).toBeTruthy();
    expect(screen.getByText("100")).toBeTruthy(); // appearances
    expect(screen.getByText("40")).toBeTruthy(); // views
    expect(screen.getByText("4")).toBeTruthy(); // leads
  });

  it("flags the biggest drop-off stage", () => {
    // ratios: appearances→views 0.4, views→leads 0.1, leads→deals 0
    render(<FunnelConversion portfolio={make()} deals={0} />);
    const leak = screen.getByText(/Biggest drop-off/i);
    expect(leak.textContent).toMatch(/Leads → Deals/);
  });

  it("handles zero appearances without NaN", () => {
    render(
      <FunnelConversion
        portfolio={make({
          appearances: 0,
          clicks: 0,
          views: 0,
          leads: 0,
          ctr: 0,
          conversion: 0,
          interest_rate: 0
        })}
        deals={0}
      />
    );
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it("scales bars against the maximum displayed stage, not appearances alone", () => {
    render(
      <FunnelConversion
        portfolio={make({
          appearances: 0,
          clicks: 0,
          views: 2,
          leads: 0,
          ctr: 0,
          conversion: 0,
          interest_rate: 0
        })}
        deals={1}
      />
    );

    expect(screen.getByTestId("funnel-bar-views")).toHaveStyle({ width: "100%" });
    expect(screen.getByTestId("funnel-bar-deals")).toHaveStyle({ width: "50%" });
  });
});
