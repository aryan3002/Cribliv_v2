import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useReducer } from "react";
import { pgWizardReducer, initialPgWizardState } from "@/lib/pg-wizard-state";
import PgRoomsPricingStep from "../PgRoomsPricingStep";

function Harness({ sharingOpts = ["single", "double"] }: { sharingOpts?: string[] }) {
  const [state, dispatch] = useReducer(pgWizardReducer, {
    ...initialPgWizardState(),
    ui: { sharing_options: sharingOpts as any }
  });
  return (
    <>
      <PgRoomsPricingStep state={state} dispatch={dispatch} locale="en" />
      <pre data-testid="state">
        {JSON.stringify({ room_types: state.draft.room_types ?? [], step: state.currentStep })}
      </pre>
    </>
  );
}

describe("PgRoomsPricingStep", () => {
  it("renders one row per (sharing × AC) combination from ui.sharing_options", () => {
    render(<Harness sharingOpts={["single", "double"]} />);
    // 2 sharing × 2 AC = 4 data rows + 1 header
    expect(screen.getAllByRole("row")).toHaveLength(4 + 1);
  });

  it("renders 0 data rows if sharing_options is empty", () => {
    render(<Harness sharingOpts={[]} />);
    expect(screen.getAllByRole("row")).toHaveLength(1); // header only
  });

  it("upserts a room_type when valid rent + vacancy entered", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/rent single-non-ac/i), {
      target: { value: "8500" }
    });
    fireEvent.change(screen.getByLabelText(/vacancy single-non-ac/i), {
      target: { value: "4" }
    });
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.room_types).toEqual([
      { sharing: "single", ac: false, monthly_rent_paise: 850000, vacancy_count: 4 }
    ]);
  });

  // Contract change (2026-05-30): intermediate keystrokes no longer get blocked.
  // Local input value reflects what the user types; the inline rent error appears
  // on BLUR (so typing "2-0-0-0" → "2000" doesn't flash an error mid-keystroke).
  // The wizard `room_types` dispatch is still gated by validity.
  it("rejects rent below ₹2,000 on blur and does NOT write to wizard state", () => {
    render(<Harness />);
    const rent = screen.getByLabelText(/rent single-non-ac/i);
    fireEvent.change(rent, { target: { value: "1000" } });
    fireEvent.blur(rent);
    fireEvent.change(screen.getByLabelText(/vacancy single-non-ac/i), {
      target: { value: "4" }
    });
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent(/2,000.*50,000/);
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.room_types).toEqual([]);
  });

  it("rejects rent above ₹50,000 on blur", () => {
    render(<Harness />);
    const rent = screen.getByLabelText(/rent single-non-ac/i);
    fireEvent.change(rent, { target: { value: "60000" } });
    fireEvent.blur(rent);
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent(/2,000.*50,000/);
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.room_types).toEqual([]);
  });

  // Regression: typing digit-by-digit must never silently drop the input.
  // (Bug 4 in the 2026-05-30 session.)
  it("accepts a 4-digit rent typed one keystroke at a time", () => {
    render(<Harness />);
    const rent = screen.getByLabelText(/rent single-non-ac/i);
    for (const v of ["2", "20", "200", "2000"]) {
      fireEvent.change(rent, { target: { value: v } });
    }
    expect((rent as HTMLInputElement).value).toBe("2000");
    fireEvent.blur(rent);
    fireEvent.change(screen.getByLabelText(/vacancy single-non-ac/i), {
      target: { value: "2" }
    });
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.room_types).toEqual([
      { sharing: "single", ac: false, monthly_rent_paise: 200000, vacancy_count: 2 }
    ]);
  });

  it("accepts rent at the ₹2,000 boundary", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/rent single-non-ac/i), {
      target: { value: "2000" }
    });
    fireEvent.change(screen.getByLabelText(/vacancy single-non-ac/i), {
      target: { value: "1" }
    });
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.room_types).toHaveLength(1);
    expect(s.room_types[0].monthly_rent_paise).toBe(200000);
  });

  it("accepts rent at the ₹50,000 boundary", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/rent single-non-ac/i), {
      target: { value: "50000" }
    });
    fireEvent.change(screen.getByLabelText(/vacancy single-non-ac/i), {
      target: { value: "1" }
    });
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.room_types[0].monthly_rent_paise).toBe(5_000_000);
  });

  it("Next button blocks when no valid rooms exist", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    expect(
      screen.getAllByRole("alert").some((a) => /at least one room/i.test(a.textContent ?? ""))
    ).toBe(true);
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.step).toBe(1);
  });

  // Rooms&Pricing is step 3 in the 7-step wizard: Back → 2 (Location), Next → 4 (Payment).
  it("Next advances to step 4 (Payment) when at least one valid room exists", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/rent single-non-ac/i), {
      target: { value: "8500" }
    });
    fireEvent.change(screen.getByLabelText(/vacancy single-non-ac/i), {
      target: { value: "4" }
    });
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.step).toBe(4);
  });

  it("Back returns to step 2 (Location)", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.step).toBe(2);
  });
});
