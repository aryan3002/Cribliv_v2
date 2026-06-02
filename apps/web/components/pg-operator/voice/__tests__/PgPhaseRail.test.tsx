import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PgPhaseRail } from "../PgPhaseRail";

describe("PgPhaseRail", () => {
  it("marks the current phase active and earlier phases done", () => {
    render(<PgPhaseRail phase="pricing" />);
    expect(screen.getByTestId("phase-pricing").getAttribute("data-state")).toBe("active");
    expect(screen.getByTestId("phase-greeting").getAttribute("data-state")).toBe("done");
    expect(screen.getByTestId("phase-discovery").getAttribute("data-state")).toBe("done");
    expect(screen.getByTestId("phase-rules").getAttribute("data-state")).toBe("upcoming");
  });

  it("renders all phases except the terminal 'done'", () => {
    render(<PgPhaseRail phase="greeting" />);
    expect(screen.getByTestId("phase-confirmation")).toBeTruthy();
    expect(screen.queryByTestId("phase-done")).toBeNull();
  });
});
