import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MapResultsSheet } from "../MapResultsSheet";

describe("MapResultsSheet", () => {
  it("always shows the maya line and toggles snap", () => {
    const onSnap = vi.fn();
    render(
      <MapResultsSheet
        mayaLine="Seven in Gomti Nagar. Cheapest ₹17k."
        snap="peek"
        onSnapChange={onSnap}
      >
        <div>card-content</div>
      </MapResultsSheet>
    );
    expect(screen.getByText(/Seven in Gomti Nagar/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /expand results/i }));
    expect(onSnap).toHaveBeenCalledWith("half");
  });
});
