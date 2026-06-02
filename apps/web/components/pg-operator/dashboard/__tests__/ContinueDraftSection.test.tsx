import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}));

import ContinueDraftSection from "../ContinueDraftSection";

const DRAFT = {
  draft_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  display_name: "Sun PG",
  updated_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  committed_listing_id: null
};

describe("ContinueDraftSection", () => {
  it("renders nothing when drafts is empty", () => {
    const { container } = render(<ContinueDraftSection drafts={[]} locale="en" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a draft link pointing to ?draft=<id>", () => {
    render(<ContinueDraftSection drafts={[DRAFT]} locale="en" />);
    const link = screen.getByRole("link", { name: /sun pg/i });
    expect(link).toHaveAttribute("href", `/en/pg-operator/listings/new?draft=${DRAFT.draft_id}`);
  });

  it("shows relative time for updated_at", () => {
    render(<ContinueDraftSection drafts={[DRAFT]} locale="en" />);
    expect(screen.getByText(/ago/i)).toBeInTheDocument();
  });
});
