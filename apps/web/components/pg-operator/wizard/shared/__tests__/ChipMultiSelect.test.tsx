import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChipMultiSelect from "../ChipMultiSelect";

describe("ChipMultiSelect", () => {
  const opts = [
    { value: "wifi", label: "WiFi" },
    { value: "cctv", label: "CCTV" }
  ];
  it("toggles values in and out of the array", () => {
    const onChange = vi.fn();
    render(<ChipMultiSelect label="Core" value={["wifi"]} options={opts} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "WiFi" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "CCTV" }));
    expect(onChange).toHaveBeenCalledWith(["wifi", "cctv"]);
    fireEvent.click(screen.getByRole("button", { name: "WiFi" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
