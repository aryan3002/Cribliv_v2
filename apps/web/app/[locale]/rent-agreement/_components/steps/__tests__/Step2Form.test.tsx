import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { Step2Form } from "../Step2Form";
import { step2Schema } from "@/lib/rent-agreement/schemas/step-2.zod";

describe("Step2Form", () => {
  const noop = vi.fn(() => Promise.resolve());

  it("renders key labeled fields", () => {
    render(<Step2Form agreementId="test-id" onSubmit={noop} />);
    expect(screen.getByLabelText(/full address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/property type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/furnishing/i)).toBeInTheDocument();
  });

  it("happy path: submits valid defaults and schema parses successfully", async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    render(<Step2Form agreementId="test-id" onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: /advance/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    const payload = (onSubmit.mock.calls[0] as unknown[])[0];
    const result = step2Schema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("failure path: clears full_address and does NOT call onSubmit", async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    render(<Step2Form agreementId="test-id" onSubmit={onSubmit} />);

    const addressField = screen.getByLabelText(/full address/i);
    fireEvent.change(addressField, { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: /advance/i }));

    // Wait a tick to be sure no async call fires
    await new Promise((r) => setTimeout(r, 50));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
