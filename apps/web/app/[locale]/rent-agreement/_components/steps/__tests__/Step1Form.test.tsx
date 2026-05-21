import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { Step1Form } from "../Step1Form";
import { step1Schema } from "@/lib/rent-agreement/schemas/step-1.zod";

describe("Step1Form", () => {
  const baseProps = {
    agreementId: "test-id",
    onSubmit: vi.fn().mockResolvedValue(undefined),
    busy: false
  };

  it("renders key labeled fields", () => {
    render(<Step1Form {...baseProps} />);
    expect(screen.getByLabelText(/owner.*full name/i)).toBeTruthy();
    expect(screen.getByLabelText(/tenant.*full name/i)).toBeTruthy();
  });

  it("happy path: submits valid payload and onSubmit is called once", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Step1Form {...baseProps} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: /advance/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    const arg = onSubmit.mock.calls[0][0];
    const result = step1Schema.safeParse(arg);
    expect(result.success).toBe(true);
  });

  it("failure path: clears required field, does not call onSubmit", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Step1Form {...baseProps} onSubmit={onSubmit} />);

    // Clear the owner full_name field
    const ownerFullName = screen.getByLabelText(/owner.*full name/i);
    fireEvent.change(ownerFullName, { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: /advance/i }));

    // Wait a tick to confirm onSubmit was NOT called
    await new Promise((r) => setTimeout(r, 50));
    expect(onSubmit).not.toHaveBeenCalled();
    // Errors should be visible
    expect(screen.getByText(/error/i)).toBeTruthy();
  });
});
