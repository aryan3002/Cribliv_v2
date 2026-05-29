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

  it("rejects rent below ₹2,000 with an inline error and does NOT write to state", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/rent single-non-ac/i), {
      target: { value: "1000" } // ₹1,000 = 100000 paise, below 200000 min
    });
    fireEvent.change(screen.getByLabelText(/vacancy single-non-ac/i), {
      target: { value: "4" }
    });
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent(/2,000.*50,000/);
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.room_types).toEqual([]);
  });

  it("rejects rent above ₹50,000 with an inline error", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/rent single-non-ac/i), {
      target: { value: "60000" } // ₹60,000 = 6,000,000 paise
    });
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent(/2,000.*50,000/);
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.room_types).toEqual([]);
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

  it("Next advances to step 3 when at least one valid room exists", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/rent single-non-ac/i), {
      target: { value: "8500" }
    });
    fireEvent.change(screen.getByLabelText(/vacancy single-non-ac/i), {
      target: { value: "4" }
    });
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.step).toBe(3);
  });

  it("Back returns to step 1", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.step).toBe(1);
  });
});
