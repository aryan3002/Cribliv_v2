import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AddListingTab } from "../AddListingTab";

vi.mock("../../../listing-wizard/ListingWizard", () => ({
  ListingWizard: ({ mode }: { mode: string }) => <div data-testid="wizard">mode:{mode}</div>
}));

describe("AddListingTab", () => {
  it("mounts the shared wizard in admin mode", () => {
    render(<AddListingTab />);
    expect(screen.getByTestId("wizard")).toHaveTextContent("mode:admin");
  });

  it("explains that the listing goes to the owner, not the worker", () => {
    render(<AddListingTab />);
    expect(screen.getByText(/owner's number/i)).toBeInTheDocument();
  });
});
