import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { IntentChipRail } from "../intent-chip-rail";
// Value-importing nav-model.ts is fine HERE: this is a test file, it never
// ships to a browser bundle. It's also fine in the component under test —
// see the bundle-size note in intent-chip-rail.tsx — but the assertions
// below still call the real builders directly (rather than hand-rolling
// fixtures) so this test catches real drift between the rail and the
// desktop panel, the same way nav-panel.test.tsx does for NavPanelView.
// Namespace import (rather than named) so vi.spyOn(navModel, "...") below
// can override just the builder a given test needs, same pattern as
// lib/__tests__/blog-api.test.ts's `vi.spyOn(api, "fetchApi")`.
import * as navModel from "../../../lib/nav/nav-model";
import type { NavColumn } from "../../../lib/nav/nav-model";
import { localityLinks } from "../../../lib/nav/localities";
import { PG_CITY_CONTENT } from "../../../lib/pg-city-content";

const { buildRentPanel, buildPgPanel } = navModel;

// Restores every vi.spyOn from the "no intent columns" tests below. A
// concise arrow is safe here — vi.restoreAllMocks() returns the `vi` object,
// not a mock function, so Vitest never mistakes it for a per-test teardown
// callback (contrast the beforeEach(() => mock.mockReset()) trap noted in
// app/api/nav/times/__tests__/route.test.ts, which returns the mock itself).
afterEach(() => vi.restoreAllMocks());

/** Every link from every non-place column, in column order. */
function intentLinks(columns: NavColumn[]) {
  return columns.filter((c) => c.kind !== "place").flatMap((c) => c.links);
}

describe("IntentChipRail", () => {
  it('renders every intent-column link from the rent panel for surface="rent"', () => {
    render(<IntentChipRail locale="en" citySlug="lucknow" surface="rent" />);

    const expected = intentLinks(buildRentPanel("en", "lucknow").columns);
    expect(expected.length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link")).toHaveLength(expected.length);
    for (const link of expected) {
      expect(screen.getByRole("link", { name: link.label })).toHaveAttribute("href", link.href);
    }
  });

  it('renders every intent-column link from the PG panel for surface="pg"', () => {
    render(<IntentChipRail locale="en" citySlug="lucknow" surface="pg" />);

    const expected = intentLinks(buildPgPanel("en", "lucknow").columns);
    expect(expected.length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link")).toHaveLength(expected.length);
    for (const link of expected) {
      expect(screen.getByRole("link", { name: link.label })).toHaveAttribute("href", link.href);
    }
  });

  it("never builds its own URL — every rendered href is reference-identical to a link the builder produced", () => {
    render(<IntentChipRail locale="en" citySlug="jaipur" surface="rent" />);

    const expectedHrefs = new Set(
      intentLinks(buildRentPanel("en", "jaipur").columns).map((l) => l.href)
    );
    for (const rendered of screen.getAllByRole("link")) {
      expect(expectedHrefs.has(rendered.getAttribute("href")!)).toBe(true);
    }
  });

  it("excludes the Popular localities column on the rent surface", () => {
    render(<IntentChipRail locale="en" citySlug="lucknow" surface="rent" />);

    const localities = localityLinks("en", "lucknow");
    expect(localities.length).toBeGreaterThan(0);
    for (const link of localities) {
      expect(screen.queryByRole("link", { name: link.label })).not.toBeInTheDocument();
    }
  });

  it("excludes the Popular PG hubs column on the pg surface", () => {
    render(<IntentChipRail locale="en" citySlug="delhi" surface="pg" />);

    const hubs = PG_CITY_CONTENT["delhi"]?.hubs ?? [];
    expect(hubs.length).toBeGreaterThan(0);
    for (const hub of hubs) {
      expect(screen.queryByRole("link", { name: hub })).not.toBeInTheDocument();
    }
  });

  it("uses Hindi labels and hrefs for hi", () => {
    render(<IntentChipRail locale="hi" citySlug="lucknow" surface="rent" />);

    const expected = intentLinks(buildRentPanel("hi", "lucknow").columns);
    expect(expected.length).toBeGreaterThan(0);
    for (const link of expected) {
      expect(screen.getByRole("link", { name: link.label })).toHaveAttribute("href", link.href);
    }
    // Sanity check that these are genuinely Hindi, not English strings that
    // happen to coincide across locales (see nav-model.test.ts's own
    // "Hindi actually differs from English" suite for the general version).
    expect(screen.getByText("2 बीएचके फ्लैट")).toBeInTheDocument();
  });

  it("renders nothing when the rent panel has no intent columns", () => {
    vi.spyOn(navModel, "buildRentPanel").mockReturnValueOnce({
      id: "rent",
      columns: [
        {
          title: "Popular localities",
          kind: "place",
          links: [{ label: "Gomti Nagar", href: "/en/city/lucknow/gomti-nagar" }]
        }
      ]
    });

    const { container } = render(<IntentChipRail locale="en" citySlug="lucknow" surface="rent" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the pg panel has no columns at all", () => {
    vi.spyOn(navModel, "buildPgPanel").mockReturnValueOnce({ id: "pg", columns: [] });

    const { container } = render(<IntentChipRail locale="en" citySlug="lucknow" surface="pg" />);
    expect(container).toBeEmptyDOMElement();
  });
});
