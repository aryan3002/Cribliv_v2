import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IntentChips } from "../IntentChips";

describe("IntentChips", () => {
  it("renders applied and struck chips and fires onBell", () => {
    const onBell = vi.fn();
    render(
      <IntentChips
        chips={[
          { kind: "bhk", label: "2 BHK", status: "applied" },
          {
            kind: "amenity",
            label: "parking",
            status: "unsupported",
            reason: "can't filter parking yet"
          }
        ]}
        onBell={onBell}
      />
    );
    expect(screen.getByText("2 BHK")).toBeTruthy();
    const bell = screen.getByRole("button", { name: /parking/i });
    fireEvent.click(bell);
    expect(onBell).toHaveBeenCalledOnce();
  });
});
