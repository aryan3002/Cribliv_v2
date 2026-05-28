import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { Step3Form } from "../Step3Form";
import { step3Schema } from "@/lib/rent-agreement/schemas/step-3.zod";

describe("Step3Form", () => {
  const baseProps = {
    agreementId: "test-id",
    onSubmit: vi.fn().mockResolvedValue(undefined),
    busy: false
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders key labeled fields (rent, tenure, state select)", () => {
    render(<Step3Form {...baseProps} />);
    expect(screen.getByLabelText(/monthly rent/i)).toBeTruthy();
    expect(screen.getByLabelText(/tenure/i)).toBeTruthy();
    expect(screen.getByLabelText(/state/i)).toBeTruthy();
  });

  it("happy path: defaults are valid, onSubmit called once with paise values", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Step3Form {...baseProps} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: /advance/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    const arg = onSubmit.mock.calls[0][0];
    const result = step3Schema.safeParse(arg);
    expect(result.success).toBe(true);

    // Rent must be in paise (25000 rupees * 100 = 2500000)
    expect((arg as { rent_amount_paise: number }).rent_amount_paise).toBe(2500000);
    // Security deposit must be in paise (50000 rupees * 100 = 5000000)
    expect((arg as { security_deposit_paise: number }).security_deposit_paise).toBe(5000000);
  });

  it("D6 path: tenure > 11 without acknowledgement blocks submit, then allows after ack", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Step3Form {...baseProps} onSubmit={onSubmit} />);

    // Change tenure to 12 (triggers D6 rule)
    const tenureInput = screen.getByLabelText(/tenure/i);
    fireEvent.change(tenureInput, { target: { value: "12" } });

    // acknowledge_registration_required is still false — should fail
    fireEvent.click(screen.getByRole("button", { name: /advance/i }));

    await new Promise((r) => setTimeout(r, 50));
    expect(onSubmit).not.toHaveBeenCalled();

    // Check the acknowledgement checkbox
    const ackCheckbox = screen.getByRole("checkbox", { name: /acknowledge/i });
    fireEvent.click(ackCheckbox);

    // Now click Advance again — should succeed
    fireEvent.click(screen.getByRole("button", { name: /advance/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    const arg = onSubmit.mock.calls[0][0];
    const result = step3Schema.safeParse(arg);
    expect(result.success).toBe(true);
  });
});
