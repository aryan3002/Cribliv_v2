import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LocationStep } from "../LocationStep";
import type { WizardForm } from "../types";

/**
 * LocationStep already renders a locality search with Places autocomplete and a
 * draggable pin. These tests lock in the resilience the owner actually needs:
 * a selected suggestion drops the pin AND fixes a stale city, an unavailable
 * Places service still lets the owner proceed manually, and a failed
 * place-details lookup never silently pretends a pin was placed.
 */

type PlacesMock = {
  predictions: Array<{
    place_id: string;
    description: string;
    structured_formatting: { main_text: string; secondary_text: string };
  }>;
  fetchPredictions: ReturnType<typeof vi.fn>;
  getPlaceDetails: ReturnType<typeof vi.fn>;
  clearPredictions: ReturnType<typeof vi.fn>;
  loading: boolean;
  enabled: boolean;
  ready: boolean;
  error: "unavailable" | "request_failed" | null;
  noResults: boolean;
};

const placesMock: PlacesMock = {
  predictions: [],
  fetchPredictions: vi.fn(),
  getPlaceDetails: vi.fn(),
  clearPredictions: vi.fn(),
  loading: false,
  enabled: true,
  ready: true,
  error: null,
  noResults: false
};

vi.mock("../../../lib/google-places", () => ({
  useGooglePlaces: () => placesMock
}));

vi.mock("../../../lib/google-maps", () => ({
  ensureMapsLoaded: () => Promise.resolve()
}));

const markerInstances: unknown[] = [];
const mapInstances: unknown[] = [];

function installGoogleGlobal() {
  markerInstances.length = 0;
  mapInstances.length = 0;
  (globalThis as unknown as { google: unknown }).google = {
    maps: {
      Map: class {
        constructor() {
          mapInstances.push(this);
        }
        addListener = vi.fn();
        getCenter = () => ({ lat: () => 0, lng: () => 0 });
        setCenter = vi.fn();
        panTo = vi.fn();
        setZoom = vi.fn();
      },
      Marker: class {
        constructor(opts: unknown) {
          markerInstances.push(opts);
        }
        addListener = vi.fn();
        setMap = vi.fn();
      },
      Size: class {},
      Point: class {},
      Animation: { DROP: "DROP" },
      ControlPosition: { RIGHT_BOTTOM: "RIGHT_BOTTOM" },
      event: { trigger: vi.fn() }
    }
  };
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
}

function baseForm(overrides: Partial<WizardForm> = {}): WizardForm {
  return {
    title: "",
    description: "",
    listing_type: "flat_house",
    monthly_rent: "",
    deposit: "",
    furnishing: "unfurnished",
    city: "",
    locality: "",
    address: "",
    landmark: "",
    pincode: "",
    lat: null,
    lng: null,
    bedrooms: "",
    bathrooms: "",
    area_sqft: "",
    amenities: [],
    preferred_tenant: "",
    beds: "",
    sharing_type: "",
    meals_included: false,
    attached_bathroom: false,
    ...overrides
  };
}

beforeEach(() => {
  installGoogleGlobal();
  placesMock.predictions = [];
  placesMock.enabled = true;
  placesMock.ready = true;
  placesMock.error = null;
  placesMock.noResults = false;
  placesMock.getPlaceDetails = vi.fn();
  placesMock.fetchPredictions = vi.fn();
  placesMock.clearPredictions = vi.fn();
});

afterEach(() => {
  delete (globalThis as unknown as { google?: unknown }).google;
  vi.clearAllMocks();
});

describe("LocationStep", () => {
  it("drops the pin and replaces a stale city when a suggestion is selected", async () => {
    placesMock.predictions = [
      {
        place_id: "p-gomti",
        description: "Gomti Nagar, Lucknow, Uttar Pradesh",
        structured_formatting: { main_text: "Gomti Nagar", secondary_text: "Lucknow" }
      }
    ];
    placesMock.getPlaceDetails = vi.fn().mockResolvedValue({
      place_id: "p-gomti",
      name: "Gomti Nagar",
      formatted_address: "Gomti Nagar, Lucknow, Uttar Pradesh, India",
      geometry: { lat: 26.85, lng: 81.0 }
    });

    const updateField = vi.fn();
    // The form already has a stale, inconsistent city selected.
    render(
      <LocationStep form={baseForm({ city: "delhi" })} errors={[]} updateField={updateField} />
    );

    // Wait for the mini-map to initialize so pin placement has a map to draw on.
    await waitFor(() => expect(mapInstances.length).toBeGreaterThan(0));

    const localityInput = screen.getByLabelText(/locality/i);
    fireEvent.change(localityInput, { target: { value: "gomti" } });

    const suggestion = await screen.findByText("Gomti Nagar");
    fireEvent.click(suggestion);

    await waitFor(() => expect(updateField).toHaveBeenCalledWith("lat", 26.85));
    expect(updateField).toHaveBeenCalledWith("lng", 81.0);
    expect(updateField).toHaveBeenCalledWith("locality", "Gomti Nagar");
    // The stale "delhi" is replaced by the city inferred from the selected place.
    expect(updateField).toHaveBeenCalledWith("city", "lucknow");
    // A pin (marker) was dropped for the selected coordinates.
    expect(markerInstances.length).toBeGreaterThan(0);
  });

  it("shows a manual-entry fallback when Places is unavailable", () => {
    placesMock.enabled = false;
    placesMock.error = "unavailable";

    render(<LocationStep form={baseForm()} errors={[]} updateField={vi.fn()} />);

    // A field-level message that specifically flags the search being unavailable
    // (distinct from the always-present map hint), pointing owners to the map.
    expect(screen.getByText(/locality search (is )?unavailable/i)).toBeInTheDocument();
  });

  it("keeps the locality but warns when place details cannot be loaded", async () => {
    placesMock.predictions = [
      {
        place_id: "p-x",
        description: "Some Area, Lucknow",
        structured_formatting: { main_text: "Some Area", secondary_text: "Lucknow" }
      }
    ];
    placesMock.getPlaceDetails = vi.fn().mockResolvedValue(null);

    const updateField = vi.fn();
    render(<LocationStep form={baseForm()} errors={[]} updateField={updateField} />);

    const localityInput = screen.getByLabelText(/locality/i);
    fireEvent.change(localityInput, { target: { value: "some" } });

    const suggestion = await screen.findByText("Some Area");
    fireEvent.click(suggestion);

    // Locality text is preserved from the suggestion...
    await waitFor(() => expect(updateField).toHaveBeenCalledWith("locality", "Some Area"));
    // ...but the owner is told no pin was placed instead of it silently failing.
    expect(
      await screen.findByText(/couldn't place the pin|drop the pin manually|no pin/i)
    ).toBeInTheDocument();
    // No coordinates were written on a failed details lookup.
    expect(updateField).not.toHaveBeenCalledWith("lat", expect.any(Number));
  });
});
