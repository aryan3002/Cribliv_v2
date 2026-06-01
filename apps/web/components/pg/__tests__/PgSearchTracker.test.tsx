import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const searchMock = vi.fn();
vi.mock("../../../lib/pg-track", () => ({ trackPgSearch: (...a: unknown[]) => searchMock(...a) }));
import { PgSearchTracker } from "../PgSearchTracker";

beforeEach(() => searchMock.mockClear());

describe("PgSearchTracker", () => {
  it("fires pg_search_executed on mount with shown_listing_ids", () => {
    render(
      <PgSearchTracker
        city="pune"
        query="metro"
        filters={{ g: "girls" }}
        resultCount={2}
        shownListingIds={["a", "b"]}
      />
    );
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ city: "pune", result_count: 2, shown_listing_ids: ["a", "b"] })
    );
  });

  it("fires when result count is zero (zero-results path handled in tracker)", () => {
    render(<PgSearchTracker city="pune" filters={{}} resultCount={0} shownListingIds={[]} />);
    expect(searchMock).toHaveBeenCalledWith(expect.objectContaining({ result_count: 0 }));
  });

  it("does not re-fire on re-render with the same query signature", () => {
    const { rerender } = render(
      <PgSearchTracker
        city="pune"
        filters={{ g: "girls" }}
        resultCount={2}
        shownListingIds={["a"]}
      />
    );
    rerender(
      <PgSearchTracker
        city="pune"
        filters={{ g: "girls" }}
        resultCount={2}
        shownListingIds={["a"]}
      />
    );
    expect(searchMock).toHaveBeenCalledTimes(1);
  });

  it("re-fires when the query signature changes", () => {
    const { rerender } = render(
      <PgSearchTracker
        city="pune"
        filters={{ g: "girls" }}
        resultCount={2}
        shownListingIds={["a"]}
      />
    );
    rerender(
      <PgSearchTracker
        city="mumbai"
        filters={{ g: "girls" }}
        resultCount={5}
        shownListingIds={["x"]}
      />
    );
    expect(searchMock).toHaveBeenCalledTimes(2);
  });
});
