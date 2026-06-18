import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PgStepIndicator from "../PgStepIndicator";
import { PG_STEP_ORDER, STEP_META } from "@/lib/pg-wizard-steps";

// The indicator was redesigned from an <ol><li> list + progressbar into a
// <nav> of <button> step pills with aria-current. These assertions track the
// current contract (labels sourced from STEP_META so they can't rot again).
const LABELS = PG_STEP_ORDER.map((n) => STEP_META[n].label);

describe("PgStepIndicator", () => {
  it("renders the step labels in order", () => {
    render(<PgStepIndicator current={4} />);
    expect(screen.getByText("Food & Amenities")).toBeInTheDocument();
    expect(screen.getByText("Rules & Agreement")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
  });

  it("renders one step button per step", () => {
    render(<PgStepIndicator current={1} />);
    expect(screen.getAllByRole("button")).toHaveLength(PG_STEP_ORDER.length);
  });

  it("marks the current step with aria-current='step'", () => {
    render(<PgStepIndicator current={3} />);
    const steps = screen.getAllByRole("button");
    expect(steps[2]).toHaveAttribute("aria-current", "step");
    expect(steps[0]).not.toHaveAttribute("aria-current");
    expect(steps[6]).not.toHaveAttribute("aria-current");
  });

  it("renders the steps in canonical order", () => {
    render(<PgStepIndicator current={1} />);
    const steps = screen.getAllByRole("button");
    LABELS.forEach((label, i) => expect(steps[i]).toHaveTextContent(label));
  });

  it("exposes progress to screen readers (progressbar, 0% at step 1)", () => {
    render(<PgStepIndicator current={1} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("progress at step 2 = round((2-1)/7*100) = 14", () => {
    render(<PgStepIndicator current={2} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "14");
  });
});
