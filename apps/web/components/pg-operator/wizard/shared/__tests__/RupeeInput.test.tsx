import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RupeeInput from "../RupeeInput";

describe("RupeeInput", () => {
  it("renders empty input when valuePaise is null", () => {
    render(<RupeeInput valuePaise={null} onChangePaise={() => {}} aria-label="rent" />);
    expect(screen.getByLabelText("rent")).toHaveValue("");
  });

  it("renders paise as rupees (1,250,000 paise → '12500')", () => {
    render(<RupeeInput valuePaise={1250000} onChangePaise={() => {}} aria-label="rent" />);
    expect(screen.getByLabelText("rent")).toHaveValue("12500");
  });

  it("converts rupees → paise on change", () => {
    const onChangePaise = vi.fn();
    render(<RupeeInput valuePaise={null} onChangePaise={onChangePaise} aria-label="rent" />);
    fireEvent.change(screen.getByLabelText("rent"), { target: { value: "8500" } });
    expect(onChangePaise).toHaveBeenLastCalledWith(850000);
  });

  it("emits null when cleared", () => {
    const onChangePaise = vi.fn();
    render(<RupeeInput valuePaise={1250000} onChangePaise={onChangePaise} aria-label="rent" />);
    fireEvent.change(screen.getByLabelText("rent"), { target: { value: "" } });
    expect(onChangePaise).toHaveBeenLastCalledWith(null);
  });

  it("strips non-digit characters before conversion", () => {
    const onChangePaise = vi.fn();
    render(<RupeeInput valuePaise={null} onChangePaise={onChangePaise} aria-label="rent" />);
    fireEvent.change(screen.getByLabelText("rent"), { target: { value: "8,500.00" } });
    expect(onChangePaise).toHaveBeenLastCalledWith(850000 * 100);
  });

  it("shows the ₹ symbol as decorative (aria-hidden)", () => {
    const { container } = render(
      <RupeeInput valuePaise={null} onChangePaise={() => {}} aria-label="rent" />
    );
    const symbol = container.querySelector("[aria-hidden]");
    expect(symbol).toHaveTextContent("₹");
  });

  it("uses inputMode='numeric' so mobile shows numeric keypad", () => {
    render(<RupeeInput valuePaise={null} onChangePaise={() => {}} aria-label="rent" />);
    expect(screen.getByLabelText("rent")).toHaveAttribute("inputmode", "numeric");
  });
});
