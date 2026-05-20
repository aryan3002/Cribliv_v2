import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { Step4Form } from "../Step4Form";
import { step4Schema } from "@/lib/rent-agreement/schemas/step-4.zod";

describe("Step4Form", () => {
  const noop = vi.fn(() => Promise.resolve());

  it("renders key fields", () => {
    render(<Step4Form agreementId="abc" onSubmit={noop} />);

    // rent due day input
    expect(screen.getByLabelText(/rent due day/i)).toBeInTheDocument();

    // first inventory row item input
    expect(screen.getByDisplayValue("Ceiling fan")).toBeInTheDocument();

    // electricity paid by select
    expect(screen.getByLabelText(/electricity paid by/i)).toBeInTheDocument();
  });

  it("happy path: submits valid defaults and passes schema", async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    render(<Step4Form agreementId="abc" onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: /advance/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    const arg = (onSubmit.mock.calls[0] as unknown[])[0];
    const result = step4Schema.safeParse(arg);
    expect(result.success).toBe(true);
  });

  it("dynamic list: add item adds a row, remove drops it", () => {
    render(<Step4Form agreementId="abc" onSubmit={noop} />);

    const addButton = screen.getByRole("button", { name: /add item/i });
    fireEvent.click(addButton);

    // Should now have 2 item inputs (one from default, one added)
    const itemInputs = screen.getAllByPlaceholderText(/item name/i);
    expect(itemInputs).toHaveLength(2);

    // Remove the second row
    const removeButtons = screen.getAllByRole("button", { name: /remove/i });
    fireEvent.click(removeButtons[removeButtons.length - 1]);

    // Back to 1
    expect(screen.getAllByPlaceholderText(/item name/i)).toHaveLength(1);
  });

  it("failure path: rent_due_day=40 does not call onSubmit", async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    render(<Step4Form agreementId="abc" onSubmit={onSubmit} />);

    const rentDayInput = screen.getByLabelText(/rent due day/i);
    fireEvent.change(rentDayInput, { target: { value: "40" } });

    fireEvent.click(screen.getByRole("button", { name: /advance/i }));

    // Wait briefly to ensure no async call happens
    await new Promise((r) => setTimeout(r, 50));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
