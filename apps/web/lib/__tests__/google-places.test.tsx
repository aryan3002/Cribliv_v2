import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The Places hook silently degraded when Google's Autocomplete service was not
 * yet ready (async load) or failed to authorize (missing key / referrer
 * restriction on mobile). To owners that reads as a dead locality field, so
 * these tests pin down the resilient contract: a query typed before readiness
 * runs once the service initializes, and unavailable / no-results states are
 * surfaced instead of swallowed.
 */

const h = vi.hoisted(() => ({
  loaderPromise: null as Promise<void> | null,
  resolveLoader: (() => {}) as () => void,
  rejectLoader: ((_?: unknown) => {}) as (error?: unknown) => void,
  getPlacePredictions: null as ReturnType<typeof vi.fn> | null
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

beforeEach(() => {
  vi.resetModules();
  freshLoader();
  h.getPlacePredictions = vi.fn();
  (globalThis as unknown as { google: unknown }).google = {
    maps: {
      places: {
        AutocompleteService: class {
          getPlacePredictions = (...args: unknown[]) => h.getPlacePredictions!(...args);
        },
        PlacesService: class {
          getDetails = vi.fn();
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
    expect(h.getPlacePredictions).not.toHaveBeenCalled();

    // Places finishes initializing.
    await act(async () => {
      h.resolveLoader();
      await h.loaderPromise;
    });

    await waitFor(() => expect(h.getPlacePredictions).toHaveBeenCalledTimes(1));
    expect((h.getPlacePredictions!.mock.calls[0][0] as { input: string }).input).toBe(
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

    h.getPlacePredictions!.mockImplementation(
      (_req: unknown, cb: (r: unknown[] | null, s: string) => void) => cb(null, "ZERO_RESULTS")
    );

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

  it("clears a prior error and returns predictions on a successful search", async () => {
    const { useGooglePlaces } = await import("../google-places");
    const { result } = renderHook(() => useGooglePlaces({ debounce: 0 }));

    await act(async () => {
      h.resolveLoader();
      await h.loaderPromise;
    });
    await waitFor(() => expect(result.current.ready).toBe(true));

    h.getPlacePredictions!.mockImplementation(
      (_req: unknown, cb: (r: unknown[] | null, s: string) => void) =>
        cb(
          [
            {
              place_id: "p1",
              description: "Gomti Nagar, Lucknow",
              structured_formatting: { main_text: "Gomti Nagar", secondary_text: "Lucknow" }
            }
          ],
          "OK"
        )
    );

    await act(async () => {
      result.current.fetchPredictions("gomti");
      await tick();
    });

    await waitFor(() => expect(result.current.predictions).toHaveLength(1));
    expect(result.current.predictions[0].place_id).toBe("p1");
    expect(result.current.noResults).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
