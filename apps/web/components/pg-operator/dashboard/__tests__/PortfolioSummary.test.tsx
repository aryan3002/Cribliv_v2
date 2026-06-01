import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PgPortfolioSummary } from "@cribliv/shared-types";
import { PortfolioSummary } from "../PortfolioSummary";

function make(over: Partial<PgPortfolioSummary> = {}): PgPortfolioSummary {
  return {
    appearances: 140,
    clicks: 28,
    views: 70,
    leads: 14,
    ctr: 0.2,
    interest_rate: 0.2,
    conversion: 0.1,
    deltas: { appearances: 1, views: -0.5, leads: null },
    ...over
  };
}

describe("PortfolioSummary", () => {
  it("renders the headline metrics", () => {
    render(<PortfolioSummary portfolio={make()} />);
    expect(screen.getByText("140")).toBeTruthy();
    expect(screen.getByText("70")).toBeTruthy();
    expect(screen.getByText("14")).toBeTruthy();
    expect(screen.getByText("20%")).toBeTruthy(); // ctr
    expect(screen.getByText("10%")).toBeTruthy(); // conversion
  });

  it("shows an up delta for positive change", () => {
    render(
      <PortfolioSummary
        portfolio={make({ deltas: { appearances: 1, views: null, leads: null } })}
      />
    );
    expect(screen.getByText("+100%")).toBeTruthy();
  });

  it("shows a down delta for negative change", () => {
    render(
      <PortfolioSummary
        portfolio={make({ deltas: { appearances: -0.5, views: null, leads: null } })}
      />
    );
    expect(screen.getByText("-50%")).toBeTruthy();
  });

  it("shows — when a delta has no baseline (null)", () => {
    render(
      <PortfolioSummary
        portfolio={make({ deltas: { appearances: null, views: null, leads: null } })}
      />
    );
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
