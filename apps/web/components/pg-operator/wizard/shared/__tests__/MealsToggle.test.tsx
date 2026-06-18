import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MealsToggle from "../MealsToggle";

describe("MealsToggle", () => {
  it("reveals per-meal + veg chips only when food provided", () => {
    const onChange = vi.fn();
    const { rerender } = render(<MealsToggle value={{ provided: false }} onChange={onChange} />);
    expect(screen.queryByRole("button", { name: /breakfast/i })).toBeNull();
    rerender(<MealsToggle value={{ provided: true }} onChange={onChange} />);
    expect(screen.getByRole("button", { name: /breakfast/i })).toBeInTheDocument();
    // Veg-only is a Toggle (role="switch"), not a button.
    expect(screen.getByRole("switch", { name: /veg only/i })).toBeInTheDocument();
  });
  it("toggles a meal flag", () => {
    const onChange = vi.fn();
    render(<MealsToggle value={{ provided: true }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /dinner/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ provided: true, dinner: true })
    );
  });
});
