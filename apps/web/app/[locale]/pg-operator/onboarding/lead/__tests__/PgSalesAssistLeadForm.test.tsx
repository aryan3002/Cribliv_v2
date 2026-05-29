import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  submitSalesAssistLead: vi.fn()
}));

vi.mock("@/lib/pg-operator-api", () => ({
  submitSalesAssistLead: mocks.submitSalesAssistLead
}));

import PgSalesAssistLeadForm from "../PgSalesAssistLeadForm";

beforeEach(() => {
  mocks.submitSalesAssistLead.mockReset();
});

describe("PgSalesAssistLeadForm", () => {
  it("submits parsed payload and shows thank-you on success", async () => {
    mocks.submitSalesAssistLead.mockResolvedValueOnce({ ok: true, lead_id: "L-1" });
    render(<PgSalesAssistLeadForm />);
    fireEvent.change(screen.getByLabelText(/total beds/i), { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText(/city/i), { target: { value: "Bangalore" } });
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: "+919876543210" } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() =>
      expect(mocks.submitSalesAssistLead).toHaveBeenCalledWith({
        total_beds: 60,
        city: "Bangalore",
        phone: "+919876543210",
        notes: ""
      })
    );
    expect(await screen.findByText(/thanks.*reach out/i)).toBeInTheDocument();
  });

  it("includes notes when present", async () => {
    mocks.submitSalesAssistLead.mockResolvedValueOnce({ ok: true, lead_id: "L-2" });
    render(<PgSalesAssistLeadForm />);
    fireEvent.change(screen.getByLabelText(/total beds/i), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText(/city/i), { target: { value: "Pune" } });
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: "+919900112233" } });
    fireEvent.change(screen.getByRole("textbox", { name: /notes/i }), {
      target: { value: "Multi-property operator" }
    });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() =>
      expect(mocks.submitSalesAssistLead).toHaveBeenCalledWith(
        expect.objectContaining({ notes: "Multi-property operator" })
      )
    );
  });

  it("surfaces API errors as an alert", async () => {
    mocks.submitSalesAssistLead.mockRejectedValueOnce(new Error("boom"));
    render(<PgSalesAssistLeadForm />);
    fireEvent.change(screen.getByLabelText(/total beds/i), { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText(/city/i), { target: { value: "BLR" } });
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: "+91…" } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/boom/));
    expect(screen.queryByText(/thanks/i)).not.toBeInTheDocument();
  });

  it("after success, form is replaced with thank-you (no resubmit possible)", async () => {
    mocks.submitSalesAssistLead.mockResolvedValueOnce({ ok: true, lead_id: "L-3" });
    render(<PgSalesAssistLeadForm />);
    fireEvent.change(screen.getByLabelText(/total beds/i), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText(/city/i), { target: { value: "BLR" } });
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: "+91…" } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    await screen.findByText(/thanks.*reach out/i);
    expect(screen.queryByRole("button", { name: /submit/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/total beds/i)).not.toBeInTheDocument();
  });
});
