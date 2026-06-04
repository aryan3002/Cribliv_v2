import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PresetCard from "../PresetCard";
import TimeRange from "../TimeRange";
import Disclosure from "../Disclosure";

describe("PresetCard", () => {
  it("fires onSelect and reflects selected state", () => {
    const onSelect = vi.fn();
    render(<PresetCard title="Students" selected onSelect={onSelect} />);
    const btn = screen.getByRole("button", { name: /Students/ });
    expect(btn).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(btn);
    expect(onSelect).toHaveBeenCalled();
  });
});

describe("TimeRange", () => {
  it("emits from/to changes", () => {
    const onChange = vi.fn();
    render(<TimeRange label="Quiet hours" from="22:00" to="06:00" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/from/i), { target: { value: "23:00" } });
    expect(onChange).toHaveBeenCalledWith({ from: "23:00", to: "06:00" });
  });
});

describe("Disclosure", () => {
  it("hides children until toggled", () => {
    render(
      <Disclosure summary="Add details">
        <p>secret</p>
      </Disclosure>
    );
    expect(screen.queryByText("secret")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Add details/ }));
    expect(screen.getByText("secret")).toBeInTheDocument();
  });
});
