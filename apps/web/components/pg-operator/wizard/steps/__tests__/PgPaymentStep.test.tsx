import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useReducer } from "react";
import { pgWizardReducer, initialPgWizardState } from "@/lib/pg-wizard-state";
import PgPaymentStep from "../PgPaymentStep";

function Harness() {
  const [state, dispatch] = useReducer(pgWizardReducer, initialPgWizardState());
  return (
    <>
      <PgPaymentStep state={state} dispatch={dispatch} locale="en" />
      <pre data-testid="state">
        {JSON.stringify({
          pg_details: state.draft.pg_details ?? {},
          step: state.currentStep
        })}
      </pre>
    </>
  );
}

describe("PgPaymentStep", () => {
  it("captures notice period + lock-in", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/notice period/i), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText(/lock.in/i), { target: { value: "3" } });
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.pg_details.notice_period_days).toBe(30);
    expect(s.pg_details.lock_in_months).toBe(3);
  });

  it("toggles electricity_mode via chip", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /submetered/i }));
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.pg_details.electricity_mode).toBe("submetered");
  });

  it("captures maintenance (rupees → paise)", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/maintenance/i), { target: { value: "500" } });
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.pg_details.maintenance_paise).toBe(50_000);
  });

  it("toggles payment modes additively", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /upi/i }));
    fireEvent.click(screen.getByRole("button", { name: /bank_transfer/i }));
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.pg_details.payment_modes).toEqual(expect.arrayContaining(["upi", "bank_transfer"]));
  });

  it("removes a payment mode when toggled twice", () => {
    render(<Harness />);
    const upi = screen.getByRole("button", { name: /upi/i });
    fireEvent.click(upi);
    fireEvent.click(upi);
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.pg_details.payment_modes).toEqual([]);
  });

  it("captures price_negotiable", () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText(/price negotiable/i));
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.pg_details.price_negotiable).toBe(true);
  });

  it("captures rent_due_day", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/rent due day/i), { target: { value: "5" } });
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.pg_details.rent_due_day).toBe(5);
  });

  it("stores late_fee_policy as an object with note key", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/late fee policy/i), {
      target: { value: "₹100/day" }
    });
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.pg_details.late_fee_policy).toEqual({ note: "₹100/day" });
  });

  it("Back goes to step 2, Next goes to step 4", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    expect(JSON.parse(screen.getByTestId("state").textContent!).step).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    expect(JSON.parse(screen.getByTestId("state").textContent!).step).toBe(4);
  });
});
