import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { Step6Form } from "../Step6Form";

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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders both file inputs — Landlord signature and Tenant signature", () => {
    render(<Step6Form {...baseProps} />);
    expect(screen.getByLabelText(/landlord signature/i)).toBeTruthy();
    expect(screen.getByLabelText(/tenant signature/i)).toBeTruthy();
  });

  it("Advance button is disabled before any upload", () => {
    render(<Step6Form {...baseProps} />);
    const btn = screen.getByRole("button", { name: /advance/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("after both uploads succeed, Advance is enabled and calls onSubmit with { confirm: true }", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Step6Form {...baseProps} onSubmit={onSubmit} />);

    const landlordInput = screen.getByLabelText(/landlord signature/i);
    const tenantInput = screen.getByLabelText(/tenant signature/i);

    fireEvent.change(landlordInput, {
      target: {
        files: [new File(["x"], "landlord.png", { type: "image/png" })]
      }
    });

    await waitFor(() => expect(screen.getByText(/✓ Saved/i)).toBeTruthy());

    fireEvent.change(tenantInput, {
      target: {
        files: [new File(["x"], "tenant.png", { type: "image/png" })]
      }
    });

    await waitFor(() => {
      const saved = screen.getAllByText(/✓ Saved/i);
      expect(saved.length).toBe(2);
    });

    const btn = screen.getByRole("button", { name: /advance/i });
    expect((btn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(btn);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ confirm: true }));
  });
});
