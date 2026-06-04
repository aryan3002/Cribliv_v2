import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Stepper from "../Stepper";

describe("Stepper", () => {
  it("increments, decrements, and clamps to min", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Stepper label="Beds" value={2} min={0} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /increase/i }));
    expect(onChange).toHaveBeenCalledWith(3);
    rerender(<Stepper label="Beds" value={0} min={0} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /decrease/i }));
    expect(onChange).toHaveBeenLastCalledWith(0);
  });
});
