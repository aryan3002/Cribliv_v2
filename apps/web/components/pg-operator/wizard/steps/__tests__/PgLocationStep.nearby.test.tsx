import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useReducer } from "react";

vi.mock("@/lib/google-places", () => ({
  useGooglePlaces: vi.fn(() => ({
    predictions: [],
    fetchPredictions: vi.fn(),
    getPlaceDetails: vi.fn(),
    clearPredictions: vi.fn(),
    loading: false,
    enabled: true
  }))
}));
vi.mock("@/lib/pg-funnel", () => ({ trackPgFunnel: vi.fn() }));
vi.mock("@/lib/pg-operator-api", () => ({
  listCityLocalities: vi.fn(() => Promise.resolve({ items: [] }))
}));
vi.mock("@/lib/google-maps", () => ({ ensureMapsLoaded: vi.fn(() => Promise.resolve()) }));

import { pgWizardReducer, initialPgWizardState } from "@/lib/pg-wizard-state";
import PgLocationStep from "../PgLocationStep";

function Harness() {
  const [state, dispatch] = useReducer(pgWizardReducer, initialPgWizardState());
  return (
    <>
      <PgLocationStep state={state} dispatch={dispatch} locale="en" accessToken="t" />
      <pre data-testid="state">{JSON.stringify(state.draft.pg_details?.nearby ?? {})}</pre>
    </>
  );
}

describe("PgLocationStep nearby", () => {
  it("adds a metro landmark as a chip-managed array", () => {
    render(<Harness />);
    const input = screen.getByLabelText(/add metro|nearby metro/i);
    fireEvent.change(input, { target: { value: "Hazratganj Metro" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("state").textContent).toContain("Hazratganj Metro");
  });
});
