import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useReducer } from "react";

const mocks = vi.hoisted(() => ({
  createPgProperty: vi.fn()
}));

vi.mock("@/lib/pg-operator-api", () => ({
  createPgProperty: mocks.createPgProperty
}));

import { pgWizardReducer, initialPgWizardState } from "@/lib/pg-wizard-state";
import PgPropertyBasicsStep from "../PgPropertyBasicsStep";

beforeEach(() => {
  mocks.createPgProperty.mockReset();
});

// Helper: fill in the minimum valid fields (no city — moved to LocationStep)
function fillValid() {
  fireEvent.change(screen.getByLabelText(/property name/i), { target: { value: "Acme PG" } });
  fireEvent.change(screen.getByLabelText(/total beds/i), { target: { value: "10" } });
  fireEvent.click(screen.getByRole("button", { name: /^single$/i }));
}

function Harness({ accessToken = "tok" as string | null }: { accessToken?: string | null }) {
  const [state, dispatch] = useReducer(pgWizardReducer, initialPgWizardState());
  return (
    <>
      <PgPropertyBasicsStep
        state={state}
        dispatch={dispatch}
        locale="en"
        accessToken={accessToken}
      />
      <pre data-testid="state">
        {JSON.stringify({
          draft: state.draft,
          ui: state.ui,
          currentStep: state.currentStep,
          pgPropertyId: state.pgPropertyId
        })}
      </pre>
    </>
  );
}

describe("PgPropertyBasicsStep", () => {
  it("captures display_name, total_beds, gender_policy, tenant_type", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/property name/i), { target: { value: "Acme PG" } });
    fireEvent.change(screen.getByLabelText(/total beds/i), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: /boys/i }));
    fireEvent.click(screen.getByRole("button", { name: /students/i }));
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.draft.property.display_name).toBe("Acme PG");
    expect(s.draft.pg_details.total_beds).toBe(20);
    expect(s.draft.pg_details.gender_policy).toBe("boys");
    expect(s.draft.pg_details.tenant_type).toBe("students");
  });

  it("does NOT show a city input (city is now in LocationStep)", () => {
    render(<Harness />);
    expect(screen.queryByLabelText(/^city$/i)).not.toBeInTheDocument();
  });

  it("writes sharing_options to ui slice (not draft)", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /^double$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^single$/i }));
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.ui.sharing_options).toEqual(expect.arrayContaining(["double", "single"]));
    // Critical: never leak into draft
    expect((s.draft as any).room_config).toBeUndefined();
    expect((s.draft as any).sharing_options).toBeUndefined();
  });

  it("blocks Next with alert when display_name <2 chars", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/property name/i), { target: { value: "X" } });
    fireEvent.change(screen.getByLabelText(/total beds/i), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /^single$/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/2 chars/i);
  });

  it("blocks Next when no sharing option selected", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/property name/i), { target: { value: "Acme PG" } });
    fireEvent.change(screen.getByLabelText(/total beds/i), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/sharing option/i);
  });

  it("advances to step 2 on valid Next (property creation moved to LocationStep)", () => {
    render(<Harness />);
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.currentStep).toBe(2);
    expect(mocks.createPgProperty).not.toHaveBeenCalled();
  });

  it("does NOT call createPgProperty even with pgPropertyId unset", () => {
    render(<Harness />);
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(mocks.createPgProperty).not.toHaveBeenCalled();
  });
});
