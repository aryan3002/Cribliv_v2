import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * CommuteOverlay's office-address search was migrated off the sunset legacy
 * Places widget (`google.maps.places.Autocomplete`) onto the shared
 * `useGooglePlaces` hook (new Places API). These tests pin the wiring: typing
 * queries predictions, and picking one resolves coordinates and sets the
 * commute origin.
 */

const mocks = vi.hoisted(() => ({
  useGooglePlaces: vi.fn(),
  useMapState: vi.fn(),
  dispatch: vi.fn(),
  fetchApi: vi.fn()
}));

vi.mock("../../../lib/google-places", () => ({
  useGooglePlaces: mocks.useGooglePlaces
}));

vi.mock("../hooks/useMapState", () => ({
  useMapState: mocks.useMapState,
  useMapDispatch: () => mocks.dispatch
}));

vi.mock("../../../lib/api", () => ({
  fetchApi: mocks.fetchApi
}));

import { CommuteOverlay } from "../CommuteOverlay";

const PREDICTION = {
  place_id: "p1",
  description: "Cyber city, DLF Cyber City, DLF Phase 2, Sector 24, Gurgaon, Haryana, India",
  structured_formatting: { main_text: "Cyber city", secondary_text: "DLF Phase 2, Gurgaon" }
};

const PLACE_DETAILS = {
  place_id: "p1",
  name: "Cyber city",
  formatted_address: "DLF Cyber City, DLF Phase 2, Sector 24, Gurugram, Haryana 122002, India",
  geometry: { lat: 28.4892, lng: 77.0919 }
};

function setupPlaces(overrides: Record<string, unknown> = {}) {
  const fetchPredictions = vi.fn();
  const getPlaceDetails = vi.fn(() => Promise.resolve(PLACE_DETAILS));
  const clearPredictions = vi.fn();
  mocks.useGooglePlaces.mockReturnValue({
    predictions: [PREDICTION],
    fetchPredictions,
    getPlaceDetails,
    clearPredictions,
    enabled: true,
    ...overrides
  });
  return { fetchPredictions, getPlaceDetails, clearPredictions };
}

beforeEach(() => {
  mocks.useGooglePlaces.mockReset();
  mocks.dispatch.mockReset();
  mocks.fetchApi.mockReset();
  mocks.useMapState.mockReturnValue({
    commuteOrigin: null,
    commuteMaxMinutes: 45,
    commuteReachability: null,
    commuteReachabilityError: null,
    city: null
  });
});

describe("CommuteOverlay office search", () => {
  it("fetches predictions when typing and renders them", async () => {
    const { fetchPredictions } = setupPlaces();
    render(<CommuteOverlay map={null} showInput onCloseInput={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/office address/i), {
      target: { value: "cyber city" }
    });

    expect(fetchPredictions).toHaveBeenCalledWith("cyber city");
    expect(await screen.findByText("Cyber city")).toBeInTheDocument();
  });

  it("selecting a prediction resolves coordinates and sets the commute origin", async () => {
    const onCloseInput = vi.fn();
    const { getPlaceDetails } = setupPlaces();
    render(<CommuteOverlay map={null} showInput onCloseInput={onCloseInput} />);

    fireEvent.change(screen.getByPlaceholderText(/office address/i), {
      target: { value: "cyber city" }
    });
    fireEvent.click(await screen.findByText("Cyber city"));

    await waitFor(() => expect(getPlaceDetails).toHaveBeenCalledWith("p1"));

    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith({
        type: "SET_COMMUTE_ORIGIN",
        origin: {
          lat: 28.4892,
          lng: 77.0919,
          address: PLACE_DETAILS.formatted_address
        }
      })
    );
    expect(onCloseInput).toHaveBeenCalled();
  });

  it("does not fetch for queries shorter than 2 characters", () => {
    const { fetchPredictions } = setupPlaces({ predictions: [] });
    render(<CommuteOverlay map={null} showInput onCloseInput={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/office address/i), { target: { value: "c" } });

    expect(fetchPredictions).not.toHaveBeenCalled();
  });
});
