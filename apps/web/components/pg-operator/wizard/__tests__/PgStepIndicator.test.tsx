import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PgStepIndicator from "../PgStepIndicator";

describe("PgStepIndicator (6-step)", () => {
  it("renders 6 step items", () => {
    render(<PgStepIndicator current={1} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
  });

  it("marks the current step with aria-current='step'", () => {
    render(<PgStepIndicator current={3} />);
    const items = screen.getAllByRole("listitem");
    expect(items[2]).toHaveAttribute("aria-current", "step");
    expect(items[0]).not.toHaveAttribute("aria-current");
    expect(items[5]).not.toHaveAttribute("aria-current");
  });

  it("progress at step 1 is 0%", () => {
    render(<PgStepIndicator current={1} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("progress at step 2 = round((2-1)/6*100) = 17", () => {
    render(<PgStepIndicator current={2} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "17");
  });

  it("progress at step 6 = round((6-1)/6*100) = 83", () => {
    render(<PgStepIndicator current={6} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "83");
  });

  it("step titles match the planned 6-step grouping", () => {
    render(<PgStepIndicator current={1} />);
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual([
      "Property & Identity",
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
