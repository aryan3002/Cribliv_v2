import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../lib/use-search-suggestions", () => ({ useSearchSuggestions: vi.fn() }));

import { BlogEmbedPicker } from "../BlogEmbedPicker";
import { useSearchSuggestions } from "../../../lib/use-search-suggestions";

const LID = "11111111-2222-4333-8444-555555555555";
const PID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const onQueryChange = vi.fn();

const HOME = [
  {
    source: "cribliv",
    data: {
      type: "listing",
      label: "2BHK Gomti Nagar",
      value: LID,
      city_slug: "lucknow",
      rent: 18000,
      verified: true
    }
  },
  { source: "google", data: { description: "Gomti Nagar, Lucknow", place_id: "x" } }
];
const PG = [
  {
    source: "cribliv",
    data: {
      type: "listing",
      label: "Cozy PG Hazratganj",
      value: PID,
      city_slug: "lucknow",
      rent: 9000,
      verified: true
    }
  }
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useSearchSuggestions).mockImplementation(
    (segment: unknown) =>
      ({
        suggestions: segment === "pg" ? PG : HOME,
        isOpen: true,
        containerRef: { current: null },
        onQueryChange,
        open: vi.fn(),
        close: vi.fn()
      }) as unknown as ReturnType<typeof useSearchSuggestions>
  );
});

describe("BlogEmbedPicker", () => {
  it("inserts a listing token when a property suggestion is picked", () => {
    const onInsert = vi.fn();
    render(<BlogEmbedPicker onInsert={onInsert} />);

    fireEvent.click(screen.getByRole("button", { name: /2BHK Gomti Nagar/i }));

    expect(onInsert).toHaveBeenCalledWith(`{{listing:${LID}}}`);
  });

  it("inserts a pg token including the city when in PG mode", () => {
    const onInsert = vi.fn();
    render(<BlogEmbedPicker onInsert={onInsert} />);

    fireEvent.click(screen.getByRole("button", { name: /insert pg/i }));
    fireEvent.click(screen.getByRole("button", { name: /Cozy PG Hazratganj/i }));

    expect(onInsert).toHaveBeenCalledWith(`{{pg:lucknow/${PID}}}`);
  });

  it("calls onQueryChange as the user types", () => {
    render(<BlogEmbedPicker onInsert={vi.fn()} />);

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "gomti" } });

    expect(onQueryChange).toHaveBeenCalledWith("gomti");
  });

  it("does not offer google (locality) suggestions — only embeddable listings", () => {
    render(<BlogEmbedPicker onInsert={vi.fn()} />);
    expect(screen.queryByText(/Gomti Nagar, Lucknow/)).not.toBeInTheDocument();
  });
});
