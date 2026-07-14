import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The Places hook silently degraded when Google's Autocomplete service was not
 * yet ready (async load) or failed to authorize (missing key / referrer
 * restriction on mobile). To owners that reads as a dead locality field, so
 * these tests pin down the resilient contract: a query typed before readiness
 * runs once the service initializes, and unavailable / no-results states are
 * surfaced instead of swallowed.
 *
 * The hook targets the *new* Places API — `AutocompleteSuggestion` +
 * `Place` — because Google's legacy `AutocompleteService`/`PlacesService`
 * return REQUEST_DENIED for projects that never enabled the sunset legacy API.
 */

const h = vi.hoisted(() => ({
  loaderPromise: null as Promise<void> | null,
  resolveLoader: (() => {}) as () => void,
  rejectLoader: ((_?: unknown) => {}) as (error?: unknown) => void,
  fetchAutocompleteSuggestions: null as ReturnType<typeof vi.fn> | null
}));

vi.mock("../google-maps", () => ({
  API_KEY: "test-key",
  ensureMapsLoaded: () => h.loaderPromise
}));

function freshLoader() {
  h.loaderPromise = new Promise<void>((resolve, reject) => {
    h.resolveLoader = resolve;
    h.rejectLoader = reject;
  });
}

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

/** Build a new-API AutocompleteSuggestion entry. */
function suggestion(placeId: string, main: string, secondary: string) {
  const ft = (t: string) => ({ toString: () => t, text: t });
  return {
    placePrediction: {
      placeId,
      text: ft(`${main}, ${secondary}`),
      mainText: ft(main),
      secondaryText: ft(secondary),
      toPlace: () => ({ id: placeId, fetchFields: vi.fn().mockResolvedValue(undefined) })
    }
  };
}

beforeEach(() => {
  vi.resetModules();
  freshLoader();
  h.fetchAutocompleteSuggestions = vi.fn().mockResolvedValue({ suggestions: [] });
  (globalThis as unknown as { google: unknown }).google = {
    maps: {
      places: {
        AutocompleteSuggestion: {
          fetchAutocompleteSuggestions: (...args: unknown[]) =>
            h.fetchAutocompleteSuggestions!(...args)
        },
        AutocompleteSessionToken: class {},
        Place: class {
          id: string;
          constructor(opts: { id: string }) {
            this.id = opts.id;
          }
          fetchFields = vi.fn().mockResolvedValue(undefined);
        }
      }
    }
  };
});

afterEach(() => {
  delete (globalThis as unknown as { google?: unknown }).google;
  vi.clearAllMocks();
});

describe("useGooglePlaces resilience", () => {
  it("runs a query typed before Places is ready once it initializes", async () => {
    const { useGooglePlaces } = await import("../google-places");
    const { result } = renderHook(() => useGooglePlaces({ debounce: 0 }));

    expect(result.current.ready).toBe(false);

    // Owner types before the async Places loader has resolved.
    await act(async () => {
      result.current.fetchPredictions("gomti nagar");
      await tick();
    });

    // The debounce fired but the service was not ready, so nothing was sent yet.
    expect(h.fetchAutocompleteSuggestions).not.toHaveBeenCalled();

    // Places finishes initializing.
    await act(async () => {
      h.resolveLoader();
      await h.loaderPromise;
    });

    await waitFor(() => expect(h.fetchAutocompleteSuggestions).toHaveBeenCalledTimes(1));
    expect((h.fetchAutocompleteSuggestions!.mock.calls[0][0] as { input: string }).input).toBe(
      "gomti nagar"
    );
    expect(result.current.ready).toBe(true);
  });

  it("exposes noResults when a completed search returns nothing", async () => {
    const { useGooglePlaces } = await import("../google-places");
    const { result } = renderHook(() => useGooglePlaces({ debounce: 0 }));

    await act(async () => {
      h.resolveLoader();
      await h.loaderPromise;
    });
    await waitFor(() => expect(result.current.ready).toBe(true));

    h.fetchAutocompleteSuggestions!.mockResolvedValue({ suggestions: [] });

    await act(async () => {
      result.current.fetchPredictions("qwertyuiop");
      await tick();
    });

    await waitFor(() => expect(result.current.noResults).toBe(true));
    expect(result.current.predictions).toHaveLength(0);
    expect(result.current.error).toBeNull();
  });

  it("reports 'unavailable' when the Places loader fails to authorize", async () => {
    const { useGooglePlaces } = await import("../google-places");
    const { result } = renderHook(() => useGooglePlaces({ debounce: 0 }));

    await act(async () => {
      h.rejectLoader(new Error("RefererNotAllowedMapError"));
      await h.loaderPromise!.catch(() => {});
    });

    await waitFor(() => expect(result.current.error).toBe("unavailable"));
    expect(result.current.ready).toBe(false);
  });

  it("reports 'request_failed' when a prediction request throws", async () => {
    const { useGooglePlaces } = await import("../google-places");
    const { result } = renderHook(() => useGooglePlaces({ debounce: 0 }));

    await act(async () => {
      h.resolveLoader();
      await h.loaderPromise;
    });
    await waitFor(() => expect(result.current.ready).toBe(true));

    h.fetchAutocompleteSuggestions!.mockRejectedValue(new Error("OVER_QUERY_LIMIT"));

    await act(async () => {
      result.current.fetchPredictions("gomti");
      await tick();
    });

    await waitFor(() => expect(result.current.error).toBe("request_failed"));
    expect(result.current.predictions).toHaveLength(0);
  });

  it("clears a prior error and returns predictions on a successful search", async () => {
    const { useGooglePlaces } = await import("../google-places");
    const { result } = renderHook(() => useGooglePlaces({ debounce: 0 }));

    await act(async () => {
      h.resolveLoader();
      await h.loaderPromise;
    });
    await waitFor(() => expect(result.current.ready).toBe(true));

    h.fetchAutocompleteSuggestions!.mockResolvedValue({
      suggestions: [suggestion("p1", "Gomti Nagar", "Lucknow")]
    });

    await act(async () => {
      result.current.fetchPredictions("gomti");
      await tick();
    });

    await waitFor(() => expect(result.current.predictions).toHaveLength(1));
    expect(result.current.predictions[0].place_id).toBe("p1");
    expect(result.current.predictions[0].structured_formatting.main_text).toBe("Gomti Nagar");
    expect(result.current.predictions[0].structured_formatting.secondary_text).toBe("Lucknow");
    expect(result.current.noResults).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("resolves place details via the new Place.fetchFields API", async () => {
    const location = { lat: () => 26.85, lng: () => 81.0 };
    const fetchFields = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this.displayName = "Gomti Nagar";
      this.formattedAddress = "Gomti Nagar, Lucknow, Uttar Pradesh, India";
      this.location = location;
      return Promise.resolve(undefined);
    });
    (
      globalThis as unknown as {
        google: { maps: { places: { Place: unknown } } };
      }
    ).google.maps.places.Place = class {
      id: string;
      displayName?: string;
      formattedAddress?: string;
      location?: unknown;
      constructor(opts: { id: string }) {
        this.id = opts.id;
      }
      fetchFields = fetchFields;
    };

    const { useGooglePlaces } = await import("../google-places");
    const { result } = renderHook(() => useGooglePlaces({ debounce: 0 }));

    await act(async () => {
      h.resolveLoader();
      await h.loaderPromise;
    });
    await waitFor(() => expect(result.current.ready).toBe(true));

    let details: Awaited<ReturnType<typeof result.current.getPlaceDetails>> = null;
    await act(async () => {
      details = await result.current.getPlaceDetails("p1");
    });

    expect(fetchFields).toHaveBeenCalledTimes(1);
    expect(details).toEqual({
      place_id: "p1",
      name: "Gomti Nagar",
      formatted_address: "Gomti Nagar, Lucknow, Uttar Pradesh, India",
      geometry: { lat: 26.85, lng: 81.0 }
    });
  });
});
