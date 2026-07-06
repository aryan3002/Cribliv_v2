import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
    expect(screen.getByRole("heading", { name: /top searches/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /popular filters/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /zero-result queries/i })).toBeTruthy();

    const searches = screen.getByLabelText("Top searches");
    expect(within(searches).getByText("ac pg near metro")).toBeTruthy();
    expect(within(searches).getByText("12")).toBeTruthy();

    const filters = screen.getByLabelText("Popular filters");
    expect(within(filters).getByText("Gender policy")).toBeTruthy();
    expect(within(filters).getByText("girls")).toBeTruthy();
    expect(within(filters).getByText("9")).toBeTruthy();

    const zeroResults = screen.getByLabelText("Zero-result queries");
    expect(within(zeroResults).getByText("single ac with food")).toBeTruthy();
    expect(within(zeroResults).getByText("4")).toBeTruthy();
  });

  it("shows empty states when there is no data", () => {
    render(
      <SearchInsights insights={{ top_queries: [], top_filters: [], zero_result_queries: [] }} />
    );
    expect(screen.getByText("No searches recorded yet")).toBeTruthy();
    expect(screen.getByText("No filters used yet")).toBeTruthy();
    expect(screen.getByText("No zero-result queries")).toBeTruthy();
  });
});
