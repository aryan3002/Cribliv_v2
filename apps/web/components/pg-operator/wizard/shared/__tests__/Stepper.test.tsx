import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Stepper from "../Stepper";

describe("Stepper", () => {
  it("increments and disables the decrement at min", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Stepper label="Beds" value={2} min={0} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /increase/i }));
    expect(onChange).toHaveBeenCalledWith(3);
    // At min the decrement button is disabled (can't go below min) — so clicking
    // it is a no-op rather than clamping via onChange.
    rerender(<Stepper label="Beds" value={0} min={0} onChange={onChange} />);
    expect(screen.getByRole("button", { name: /decrease/i })).toBeDisabled();
  });
});
