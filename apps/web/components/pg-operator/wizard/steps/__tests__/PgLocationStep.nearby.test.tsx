import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useReducer } from "react";

const api = vi.hoisted(() => ({
  getPgNearby: vi.fn(),
  listCityLocalities: vi.fn(() => Promise.resolve({ items: [] }))
}));
const maps = vi.hoisted(() => ({ ensureMapsLoaded: vi.fn(() => Promise.resolve()) }));

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
vi.mock("@/lib/pg-operator-api", () => api);
vi.mock("@/lib/google-maps", () => maps);

import { pgWizardReducer, initialPgWizardState } from "@/lib/pg-wizard-state";
import PgLocationStep from "../PgLocationStep";

function Harness({ nearby }: { nearby?: Record<string, string[]> } = {}) {
  const base = initialPgWizardState();
  const [state, dispatch] = useReducer(pgWizardReducer, {
    ...base,
    draft: {
      property: { lat: 26.8467, lng: 80.9462 },
      pg_details: { nearby }
    }
  } as any);
  return (
    <>
      <PgLocationStep state={state} dispatch={dispatch} locale="en" accessToken="t" />
      <button
        type="button"
        onClick={() => dispatch({ type: "SET_FIELD", path: "property.lat", value: 26.84671 })}
      >
        Move pin within bucket
      </button>
      <pre data-testid="state">{JSON.stringify(state.draft.pg_details?.nearby ?? {})}</pre>
    </>
  );
}

function installGoogle(searchNearby: ReturnType<typeof vi.fn>) {
  class FakeMap {
    panTo = vi.fn();
    setZoom = vi.fn();
    getCenter = vi.fn(() => null);
    addListener = vi.fn();
  }
  class FakeMarker {
    setPosition = vi.fn();
    addListener = vi.fn();
    getPosition = vi.fn(() => null);
  }
  class FakeResizeObserver {
    observe() {}
    disconnect() {}
  }
  const importLibrary = vi.fn(async () => ({
    Place: { searchNearby },
    SearchNearbyRankPreference: { DISTANCE: "DISTANCE" }
  }));

  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("google", {
    maps: {
      Map: FakeMap,
      Marker: FakeMarker,
      event: { trigger: vi.fn() },
      importLibrary
    }
  });
  return importLibrary;
}

async function runNearbyLookup() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(700);
  });
}

describe("PgLocationStep nearby", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    api.getPgNearby.mockReset();
    api.listCityLocalities.mockClear();
    maps.ensureMapsLoaded.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("uses Places only for the PostGIS-empty category and preserves operator tags", async () => {
    api.getPgNearby.mockResolvedValue({
      metro: ["PostGIS Metro"],
      college: [],
      office: ["PostGIS Office"]
    });
    const searchNearby = vi.fn(async ({ includedPrimaryTypes }: any) => ({
      places: [{ displayName: `${includedPrimaryTypes[0]} place` }]
    }));
    const importLibrary = installGoogle(searchNearby);

    render(<Harness nearby={{ metro: ["Operator metro"] }} />);
    await runNearbyLookup();

    expect(importLibrary).toHaveBeenCalledWith("places");
    expect(searchNearby).toHaveBeenCalledTimes(1);
    expect(searchNearby).toHaveBeenCalledWith(
      expect.objectContaining({ includedPrimaryTypes: ["university", "school"] })
    );
    expect(screen.getByTestId("state").textContent).toContain("Operator metro");
    expect(screen.getByTestId("state").textContent).toContain("university place");
    expect(screen.getByTestId("state").textContent).toContain("PostGIS Office");
  });

  it("does not restore a category an operator manually cleared", async () => {
    api.getPgNearby.mockResolvedValue({ metro: [], college: [], office: [] });
    const searchNearby = vi.fn(async ({ includedPrimaryTypes }: any) => ({
      places: [{ displayName: `${includedPrimaryTypes[0]} place` }]
    }));
    installGoogle(searchNearby);

    render(<Harness nearby={{ metro: ["Operator metro"] }} />);
    fireEvent.click(screen.getByRole("button", { name: "remove Operator metro" }));
    await runNearbyLookup();

    expect(searchNearby).toHaveBeenCalledTimes(2);
    expect(searchNearby).not.toHaveBeenCalledWith(
      expect.objectContaining({ includedPrimaryTypes: ["subway_station", "train_station"] })
    );
    expect(screen.getByTestId("state").textContent).not.toContain("subway_station place");
  });

  it("reuses the rounded-coordinate cache for a small pin move", async () => {
    api.getPgNearby.mockResolvedValue({
      metro: ["PostGIS Metro"],
      college: ["PostGIS College"],
      office: ["PostGIS Office"]
    });
    const searchNearby = vi.fn();
    installGoogle(searchNearby);

    render(<Harness />);
    await runNearbyLookup();
    fireEvent.click(screen.getByRole("button", { name: "Move pin within bucket" }));
    await runNearbyLookup();

    expect(api.getPgNearby).toHaveBeenCalledTimes(1);
    expect(searchNearby).not.toHaveBeenCalled();
  });

  it("adds a metro landmark as a chip-managed array", () => {
    installGoogle(vi.fn());
    render(<Harness />);
    const input = screen.getByLabelText(/add metro|nearby metro/i);
    fireEvent.change(input, { target: { value: "Hazratganj Metro" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("state").textContent).toContain("Hazratganj Metro");
  });
});
