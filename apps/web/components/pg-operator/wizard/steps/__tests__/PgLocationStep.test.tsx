import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { useReducer } from "react";

const mocks = vi.hoisted(() => ({
  useGooglePlaces: vi.fn(),
  trackPgFunnel: vi.fn(),
  listCityLocalities: vi.fn()
}));

vi.mock("@/lib/google-places", () => ({
  useGooglePlaces: mocks.useGooglePlaces
}));

vi.mock("@/lib/pg-funnel", () => ({
  trackPgFunnel: mocks.trackPgFunnel
}));

vi.mock("@/lib/pg-operator-api", () => ({
  listCityLocalities: mocks.listCityLocalities
}));

// Maps init is client-only — mock ensureMapsLoaded so it never runs in tests
vi.mock("@/lib/google-maps", () => ({
  ensureMapsLoaded: vi.fn(() => Promise.resolve())
}));

import { pgWizardReducer, initialPgWizardState } from "@/lib/pg-wizard-state";
import PgLocationStep from "../PgLocationStep";

const PREDICTION = {
  place_id: "p1",
  description: "Gomti Nagar, Lucknow, Uttar Pradesh, India",
  structured_formatting: { main_text: "Gomti Nagar", secondary_text: "Lucknow" }
};

const PLACE_DETAILS = {
  place_id: "p1",
  name: "Gomti Nagar",
  formatted_address: "Gomti Nagar, Lucknow, Uttar Pradesh, India",
  geometry: { lat: 26.84, lng: 80.94 }
};

function setupMocks() {
  const getPlaceDetails = vi.fn(() => Promise.resolve(PLACE_DETAILS));
  const fetchPredictions = vi.fn();
  const clearPredictions = vi.fn();
  mocks.useGooglePlaces.mockReturnValue({
    predictions: [PREDICTION],
    fetchPredictions,
    getPlaceDetails,
    clearPredictions,
    loading: false,
    enabled: true
  });
  return { getPlaceDetails, fetchPredictions };
}

function Harness({ draftId, citySlug }: { draftId?: string; citySlug?: string }) {
  const [state, dispatch] = useReducer(pgWizardReducer, {
    ...initialPgWizardState(),
    draftId,
    draft: citySlug ? { property: { city_slug: citySlug } } : {}
  });
  return (
    <>
      <PgLocationStep state={state} dispatch={dispatch} locale="en" accessToken={null} />
      <pre data-testid="state">{JSON.stringify({ draft: state.draft })}</pre>
    </>
  );
}

beforeEach(() => {
  mocks.useGooglePlaces.mockReset();
  mocks.trackPgFunnel.mockReset();
  mocks.listCityLocalities.mockReset();
  mocks.listCityLocalities.mockResolvedValue({ items: [] });
});

describe("PgLocationStep", () => {
  it("selecting a prediction dispatches lat/lng/formatted_address", async () => {
    const { getPlaceDetails } = setupMocks();
    render(<Harness />);

    // Type to trigger predictions dropdown
    const addressInput = screen.getByLabelText(/address search/i);
    fireEvent.change(addressInput, { target: { value: "Gomti" } });

    const suggestion = await screen.findByText(/Gomti Nagar/);
    fireEvent.mouseDown(suggestion);

    await waitFor(() => expect(getPlaceDetails).toHaveBeenCalledWith("p1"));
    await waitFor(() => {
      const s = JSON.parse(screen.getByTestId("state").textContent!);
      expect(s.draft.property?.lat).toBe(26.84);
      expect(s.draft.property?.lng).toBe(80.94);
      expect(s.draft.property?.formatted_address).toBe(
        "Gomti Nagar, Lucknow, Uttar Pradesh, India"
      );
    });
  });

  it("renders a city select", () => {
    setupMocks();
    render(<Harness />);
    expect(screen.getByRole("combobox", { name: /city/i })).toBeInTheDocument();
  });

  it("snaps a geocoded pin to the nearest CANONICAL locality slug", async () => {
    setupMocks();
    // gomti-nagar sits at the geocoded point; hazratganj is far away.
    mocks.listCityLocalities.mockResolvedValue({
      items: [
        { slug: "gomti-nagar", name_en: "Gomti Nagar", lat: 26.84, lng: 80.94 },
        { slug: "hazratganj", name_en: "Hazratganj", lat: 30.0, lng: 76.0 }
      ]
    });
    render(<Harness citySlug="lucknow" />);

    // Canonical localities load into the dropdown
    await screen.findByRole("option", { name: "Gomti Nagar" });

    // Geocode via Places → snaps to the nearest canonical locality. Scope to the
    // prediction listbox ("Gomti Nagar" also appears as a dropdown <option>).
    fireEvent.change(screen.getByLabelText(/address search/i), { target: { value: "Gomti" } });
    const listbox = await screen.findByRole("listbox");
    fireEvent.mouseDown(within(listbox).getByText("Gomti Nagar"));

    await waitFor(() => {
      const s = JSON.parse(screen.getByTestId("state").textContent!);
      expect(s.draft.property?.locality_slug).toBe("gomti-nagar");
    });
  });
});
