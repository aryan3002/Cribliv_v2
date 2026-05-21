import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { Step5Form } from "../Step5Form";
import { step5Schema } from "@/lib/rent-agreement/schemas/step-5.zod";

describe("Step5Form", () => {
  const noop = vi.fn(() => Promise.resolve());

  it("renders key fields (clause checkbox, max occupants, witness 1 name)", () => {
    render(<Step5Form agreementId="abc" onSubmit={noop} />);

    // At least one clause checkbox (pets_allowed)
    expect(screen.getByLabelText(/pets allowed/i)).toBeInTheDocument();

    // Max occupants input
    expect(screen.getByLabelText(/max occupants/i)).toBeInTheDocument();

    // Witness 1 name
    expect(screen.getByDisplayValue("Mohan Rao")).toBeInTheDocument();
  });

  it("happy path: render with defaults, click Advance, onSubmit called once with valid payload", async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    render(<Step5Form agreementId="abc" onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: /advance/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    const arg = (onSubmit.mock.calls[0] as unknown[])[0];
    const result = step5Schema.safeParse(arg);
    expect(result.success).toBe(true);
  });

  it("dynamic list: clicking Add term renders an extra additional_terms input", () => {
    render(<Step5Form agreementId="abc" onSubmit={noop} />);

    // Initially no additional term inputs (empty list)
    const before = screen.queryAllByPlaceholderText(/additional term/i);
    expect(before).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /add term/i }));

    const after = screen.getAllByPlaceholderText(/additional term/i);
    expect(after).toHaveLength(1);
  });

  it("failure path: clearing witness_1 name prevents onSubmit", async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    render(<Step5Form agreementId="abc" onSubmit={onSubmit} />);

    // Clear witness 1 name (too short → validation fails)
    const w1Name = screen.getByDisplayValue("Mohan Rao");
    fireEvent.change(w1Name, { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: /advance/i }));

    await new Promise((r) => setTimeout(r, 50));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
