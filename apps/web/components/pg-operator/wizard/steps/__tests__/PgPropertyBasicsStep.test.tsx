import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
  it("captures display_name, city_slug, total_beds, gender_policy, tenant_type", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/property name/i), { target: { value: "Acme PG" } });
    fireEvent.change(screen.getByLabelText(/^city$/i), { target: { value: "bangalore" } });
    fireEvent.change(screen.getByLabelText(/total beds/i), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: /boys/i }));
    fireEvent.click(screen.getByRole("button", { name: /students/i }));
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.draft.property.display_name).toBe("Acme PG");
    expect(s.draft.property.city_slug).toBe("bangalore");
    expect(s.draft.pg_details.total_beds).toBe(20);
    expect(s.draft.pg_details.gender_policy).toBe("boys");
    expect(s.draft.pg_details.tenant_type).toBe("students");
  });

  it("lowercases city_slug input on change", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/^city$/i), { target: { value: "Bangalore" } });
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.draft.property.city_slug).toBe("bangalore");
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
    fireEvent.change(screen.getByLabelText(/^city$/i), { target: { value: "blr" } });
    fireEvent.change(screen.getByLabelText(/total beds/i), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /^single$/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/2 chars/i);
  });

  it("blocks Next when no sharing option selected", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/property name/i), { target: { value: "Acme PG" } });
    fireEvent.change(screen.getByLabelText(/^city$/i), { target: { value: "blr" } });
    fireEvent.change(screen.getByLabelText(/total beds/i), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/sharing option/i);
  });

  it("calls createPgProperty with idempotency key on first Next, then advances to step 2", async () => {
    mocks.createPgProperty.mockResolvedValueOnce({ id: "prop-1", display_name: "Acme PG" });
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/property name/i), { target: { value: "Acme PG" } });
    fireEvent.change(screen.getByLabelText(/^city$/i), { target: { value: "blr" } });
    fireEvent.change(screen.getByLabelText(/total beds/i), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /^double$/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => expect(mocks.createPgProperty).toHaveBeenCalled());
    const call = mocks.createPgProperty.mock.calls[0][0];
    expect(call.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(call.token).toBe("tok");
    expect(call.input.display_name).toBe("Acme PG");
    expect(call.input.city_slug).toBe("blr");
    await waitFor(() => {
      const s = JSON.parse(screen.getByTestId("state").textContent!);
      expect(s.pgPropertyId).toBe("prop-1");
      expect(s.currentStep).toBe(2);
    });
  });

  it("surfaces multi_property_not_enabled error with friendly message", async () => {
    const err: any = new Error("multi_property_not_enabled: V1");
    err.code = "multi_property_not_enabled";
    mocks.createPgProperty.mockRejectedValueOnce(err);
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/property name/i), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText(/^city$/i), { target: { value: "blr" } });
    fireEvent.change(screen.getByLabelText(/total beds/i), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /^single$/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/already have a property/i)
    );
  });

  it("blocks property creation without accessToken", async () => {
    render(<Harness accessToken={null} />);
    fireEvent.change(screen.getByLabelText(/property name/i), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText(/^city$/i), { target: { value: "blr" } });
    fireEvent.change(screen.getByLabelText(/total beds/i), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /^single$/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/sign in required/i);
    expect(mocks.createPgProperty).not.toHaveBeenCalled();
  });

  it("does NOT recreate property if pgPropertyId already set", async () => {
    // Use a reducer harness whose initial state already has pgPropertyId set.
    function SeededHarness() {
      const [state, dispatch] = useReducer(pgWizardReducer, {
        ...initialPgWizardState(),
        pgPropertyId: "prop-existing"
      });
      return (
        <>
          <PgPropertyBasicsStep state={state} dispatch={dispatch} locale="en" accessToken="tok" />
          <pre data-testid="state">
            {JSON.stringify({ pgPropertyId: state.pgPropertyId, step: state.currentStep })}
          </pre>
        </>
      );
    }
    render(<SeededHarness />);
    fireEvent.change(screen.getByLabelText(/property name/i), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText(/^city$/i), { target: { value: "blr" } });
    fireEvent.change(screen.getByLabelText(/total beds/i), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /^single$/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    // Should NOT have invoked createPgProperty since pgPropertyId is already set
    expect(mocks.createPgProperty).not.toHaveBeenCalled();
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.step).toBe(2);
  });
});
