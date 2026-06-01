import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PgSearchInsights } from "@cribliv/shared-types";
import { SearchInsights } from "../SearchInsights";

describe("SearchInsights", () => {
  it("renders top queries, filters and unmet demand", () => {
    const insights: PgSearchInsights = {
      top_queries: [{ query: "ac pg near metro", count: 12 }],
      top_filters: [{ key: "gender_policy", value: "girls", count: 9 }],
      zero_result_queries: [{ query: "single ac with food", count: 4 }]
    };
    render(<SearchInsights insights={insights} />);
    expect(screen.getByText("ac pg near metro")).toBeTruthy();
    expect(screen.getByText(/gender_policy/)).toBeTruthy();
    expect(screen.getByText(/girls/)).toBeTruthy();
    expect(screen.getByText("single ac with food")).toBeTruthy();
  });

  it("shows empty states when there is no data", () => {
    render(
      <SearchInsights insights={{ top_queries: [], top_filters: [], zero_result_queries: [] }} />
    );
    expect(screen.getAllByText(/No .* yet/i).length).toBeGreaterThanOrEqual(3);
  });
});
