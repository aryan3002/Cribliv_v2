import { render, screen } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { Step6Form } from "../Step6Form";

// Step6Form uses <canvas> (draw mode) and canvas-based image compression
// (upload mode). jsdom has no canvas implementation, so the draw/save paths
// cannot run here — this is a render-level test. The full signature flow is
// exercised manually on the premium plan + by Playwright when wired.
vi.mock("@/lib/rent-agreement/hooks/use-api-client", () => ({
  useApiClient: () => ({
    request: vi.fn().mockResolvedValue({ data: { saved: true, sha256: "abc" } })
  })
}));

describe("Step6Form", () => {
  const baseProps = {
    agreementId: "test-agreement-id",
    onSubmit: vi.fn().mockResolvedValue(undefined),
    busy: false
  };

  it("renders a signature capture for both parties", () => {
    render(<Step6Form {...baseProps} />);
    expect(screen.getByText(/landlord signature/i)).toBeTruthy();
    expect(screen.getByText(/tenant signature/i)).toBeTruthy();
  });

  it("offers Draw and Upload modes for each party", () => {
    render(<Step6Form {...baseProps} />);
    expect(screen.getAllByRole("tab", { name: /draw/i }).length).toBe(2);
    expect(screen.getAllByRole("tab", { name: /upload/i }).length).toBe(2);
  });

  it("'Save and continue' is disabled until both signatures are saved", () => {
    render(<Step6Form {...baseProps} />);
    const btn = screen.getByRole("button", { name: /save and continue/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});
