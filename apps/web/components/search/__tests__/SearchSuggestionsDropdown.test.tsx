import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SearchSuggestionsDropdown } from "../SearchSuggestionsDropdown";
import type { BlendedSuggestion } from "../../../lib/use-search-suggestions";

const noop = () => {};

describe("SearchSuggestionsDropdown", () => {
  it("renders nothing when there are no suggestions and no recent to show", () => {
    const { container } = render(
      <SearchSuggestionsDropdown
        suggestions={[]}
        recent={[]}
        query="gomti"
        onSelect={noop}
        onPickRecent={noop}
        onRemoveRecent={noop}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("groups suggestions into sections and fires onSelect with the picked item", () => {
    const onSelect = vi.fn();
    const suggestions: BlendedSuggestion[] = [
      { source: "cribliv", data: { type: "city", label: "Lucknow", value: "lucknow" } },
      {
        source: "cribliv",
        data: { type: "listing", label: "2BHK in Gomti Nagar", value: "listing-123" }
      }
    ];
    render(
      <SearchSuggestionsDropdown
        suggestions={suggestions}
        recent={[]}
        query="gomti"
        onSelect={onSelect}
        onPickRecent={noop}
        onRemoveRecent={noop}
      />
    );

    expect(screen.getByText("Cities")).toBeVisible();
    expect(screen.getByText("Listings")).toBeVisible();

    fireEvent.click(screen.getByText("2BHK in Gomti Nagar"));
    expect(onSelect).toHaveBeenCalledWith(suggestions[1]);
  });

  it("shows recent searches only when the query is too short to search", () => {
    const onRemoveRecent = vi.fn();
    render(
      <SearchSuggestionsDropdown
        suggestions={[]}
        recent={[{ query: "Gomti Nagar", ts: 1 }]}
        query="g"
        onSelect={noop}
        onPickRecent={noop}
        onRemoveRecent={onRemoveRecent}
      />
    );

    expect(screen.getByText("Recent")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Gomti Nagar from recent searches" })
    );
    expect(onRemoveRecent).toHaveBeenCalledWith("Gomti Nagar");
  });
});
