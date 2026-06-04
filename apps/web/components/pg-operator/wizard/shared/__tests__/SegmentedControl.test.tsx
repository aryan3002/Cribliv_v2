import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SegmentedControl from "../SegmentedControl";

describe("SegmentedControl", () => {
  const opts = [
    { value: "boys", label: "Boys" },
    { value: "girls", label: "Girls" },
    { value: "coed", label: "Co-ed" }
  ];
  it("marks the selected option pressed and fires onChange", () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="Gender" value="girls" options={opts} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Girls" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Co-ed" }));
    expect(onChange).toHaveBeenCalledWith("coed");
  });
});
