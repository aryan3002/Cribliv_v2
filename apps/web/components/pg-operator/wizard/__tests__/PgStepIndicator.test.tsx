import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PgStepIndicator from "../PgStepIndicator";

describe("PgStepIndicator (7-step)", () => {
  it("renders 7 step items", () => {
    render(<PgStepIndicator current={1} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
  });

  it("marks the current step with aria-current='step'", () => {
    render(<PgStepIndicator current={3} />);
    const items = screen.getAllByRole("listitem");
    expect(items[2]).toHaveAttribute("aria-current", "step");
    expect(items[0]).not.toHaveAttribute("aria-current");
    expect(items[6]).not.toHaveAttribute("aria-current");
  });

  it("progress at step 1 is 0%", () => {
    render(<PgStepIndicator current={1} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("progress at step 2 = round((2-1)/7*100) = 14", () => {
    render(<PgStepIndicator current={2} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "14");
  });

  it("progress at step 7 = round((7-1)/7*100) = 86", () => {
    render(<PgStepIndicator current={7} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "86");
  });

  it("step titles match the 7-step grouping", () => {
    render(<PgStepIndicator current={1} />);
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual([
      "Basics",
      "Location",
      "Rooms & Pricing",
      "Payment",
      "Rules",
      "Amenities & Food",
      "Photos & Review"
    ]);
  });

  it("has min=0, max=100 on the progressbar", () => {
    render(<PgStepIndicator current={3} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });
});
