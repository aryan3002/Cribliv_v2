import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { Step7Form } from "../Step7Form";

describe("Step7Form", () => {
  const baseProps = {
    agreementId: "test-id",
    onSubmit: vi.fn().mockResolvedValue(undefined),
    busy: false
  };

  it("renders the 'I agree to the terms' checkbox", () => {
    render(<Step7Form {...baseProps} />);
    expect(screen.getByLabelText(/i agree to the terms/i)).toBeTruthy();
  });

  it("failure path: with box unchecked, click Advance — onSubmit NOT called and error shown", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Step7Form {...baseProps} onSubmit={onSubmit} />);

    // Box is unchecked by default — just click Advance
    fireEvent.click(screen.getByRole("button", { name: /advance/i }));

    // Wait a tick to confirm onSubmit was NOT called
    await new Promise((r) => setTimeout(r, 50));
    expect(onSubmit).not.toHaveBeenCalled();

    // Inline error must be visible
    expect(screen.getByText(/you must agree to the terms to continue/i)).toBeTruthy();
  });

  it("happy path: check the box, click Advance — onSubmit called once with { agree_to_terms: true }", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Step7Form {...baseProps} onSubmit={onSubmit} />);

    // Check the checkbox
    fireEvent.click(screen.getByLabelText(/i agree to the terms/i));

    // Click Advance
    fireEvent.click(screen.getByRole("button", { name: /advance/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({ agree_to_terms: true });
  });
});
