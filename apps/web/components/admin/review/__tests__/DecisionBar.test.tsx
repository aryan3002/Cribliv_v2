import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DecisionBar } from "../DecisionBar";

const actions = [
  { key: "pause", label: "Pause", variant: "ghost" as const, requiresReason: true },
  { key: "approve", label: "Approve", variant: "primary" as const }
];

describe("DecisionBar", () => {
  it("passes the typed reason to onDecide", () => {
    const onDecide = vi.fn();
    render(<DecisionBar actions={actions} busy={null} onDecide={onDecide} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "looks good" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onDecide).toHaveBeenCalledWith("approve", "looks good");
  });

  it("disables buttons while busy", () => {
    render(<DecisionBar actions={actions} busy="approve" onDecide={vi.fn()} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons[1]).toBeDisabled(); // approve is the 2nd action
  });
});
