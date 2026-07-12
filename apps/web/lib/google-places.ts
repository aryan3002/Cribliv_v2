"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_KEY, ensureMapsLoaded } from "./google-maps";

/**
 * Lightweight Google Places Autocomplete hook.
 *
 * Requires `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` to be set. When the key is absent
 * the hook is a no-op (`enabled: false`, empty predictions).
 *
 * Resilience contract
 * -------------------
 * The Autocomplete service loads asynchronously and can fail to authorize
 * (missing key, or an HTTP-referrer restriction that the deployed origin isn't
 * on — a common mobile failure). Rather than silently swallowing those cases —
 * which makes the locality field look dead — the hook exposes explicit state:
 *   - `ready`     — the service finished initializing and can take queries.
 *   - `error`     — "unavailable" (loader/authorize failure) or
 *                   "request_failed" (a prediction request errored).
 *   - `noResults` — a completed request returned zero matches.
 * A query typed before the service is ready is queued and executed once it
 * initializes, so owners never lose the search they already typed.
 */

// Restrict suggestions to India
const COMPONENT_RESTRICTIONS = { country: "in" };

interface PlacePrediction {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
}

interface PlaceDetails {
  place_id: string;
  name: string;
  formatted_address: string;
  geometry: { lat: number; lng: number };
}

interface UseGooglePlacesOptions {
  /** Place types to filter —  e.g. ["locality", "sublocality"] */
  types?: string[];
  /** Debounce delay in ms (default 300) */
  debounce?: number;
}

export type PlacesError = "unavailable" | "request_failed";

/* eslint-disable @typescript-eslint/no-explicit-any */

let placesReady: Promise<void> | null = null;

function ensurePlacesLoaded(): Promise<void> {
  if (!API_KEY) return Promise.resolve();
  if (!placesReady) {
    placesReady = ensureMapsLoaded();
  }
  return placesReady;
}

export function useGooglePlaces(opts: UseGooglePlacesOptions = {}) {
  const { types = ["locality", "sublocality", "neighborhood"], debounce: debounceMs = 300 } = opts;
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<PlacesError | null>(null);
  const [noResults, setNoResults] = useState(false);
  const serviceRef = useRef<any>(null);
  const placesServiceRef = useRef<any>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>();
  // The most recent query typed before the service was ready. Flushed once
  // initialization completes so an early search isn't lost.
  const pendingQueryRef = useRef<string | null>(null);
  const initRef = useRef(false);

  // Keep the caller's options current without destabilizing the callbacks —
  // LocationStep passes fresh array/number literals every render.
  const typesRef = useRef(types);
  typesRef.current = types;
  const debounceRef = useRef(debounceMs);
  debounceRef.current = debounceMs;

  // Load Google Maps JS API once, tracking readiness and authorization failure.
  useEffect(() => {
    if (!API_KEY || initRef.current) return;
    initRef.current = true;

    let cancelled = false;
    ensurePlacesLoaded()
      .then(() => {
        if (cancelled) return;
        if (typeof google === "undefined" || !(google.maps as any)?.places) {
          setError("unavailable");
          return;
        }
        serviceRef.current = new (google.maps.places as any).AutocompleteService();
        const div = document.createElement("div");
        placesServiceRef.current = new (google.maps.places as any).PlacesService(div);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setError("unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const runPrediction = useCallback((input: string) => {
    const service = serviceRef.current;
    if (!service) {
      // Service not ready yet — remember the query and run it after init.
      pendingQueryRef.current = input;
      return;
    }
    setLoading(true);
    service.getPlacePredictions(
      {
        input,
        componentRestrictions: COMPONENT_RESTRICTIONS,
        types: typesRef.current
      },
      (results: any[] | null, status: string) => {
        setLoading(false);
        if (status === "OK" && results && results.length > 0) {
          setPredictions(
            results.map((r: any) => ({
              place_id: r.place_id,
              description: r.description,
              structured_formatting: {
                main_text: r.structured_formatting.main_text,
                secondary_text: r.structured_formatting.secondary_text
              }
            }))
          );
          setNoResults(false);
          setError(null);
        } else if (
          status === "ZERO_RESULTS" ||
          (status === "OK" && (!results || results.length === 0))
        ) {
          setPredictions([]);
          setNoResults(true);
          setError(null);
        } else {
          // A real request error (OVER_QUERY_LIMIT, REQUEST_DENIED, etc.).
          setPredictions([]);
          setNoResults(false);
          setError("request_failed");
        }
      }
    );
  }, []);

  // Flush a query that was typed before the service finished initializing.
  useEffect(() => {
    if (!ready) return;
    const pending = pendingQueryRef.current;
    if (pending && pending.trim().length >= 2) {
      pendingQueryRef.current = null;
      runPrediction(pending);
    }
  }, [ready, runPrediction]);

  const fetchPredictions = useCallback(
    (input: string) => {
      if (!API_KEY) {
        setPredictions([]);
        return;
      }
      if (debounceTimer.current) clearTimeout(debounceTimer.current);

      if (input.trim().length < 2) {
        setPredictions([]);
        setNoResults(false);
        pendingQueryRef.current = null;
        return;
      }

      debounceTimer.current = setTimeout(() => {
        runPrediction(input);
      }, debounceRef.current);
    },
    [runPrediction]
  );

  const getPlaceDetails = useCallback(
    (placeId: string): Promise<PlaceDetails | null> =>
      new Promise((resolve) => {
        if (!placesServiceRef.current) {
          resolve(null);
          return;
        }
        placesServiceRef.current.getDetails(
          { placeId, fields: ["name", "formatted_address", "geometry", "place_id"] },
          (place: any, status: string) => {
            if (status === "OK" && place) {
              resolve({
                place_id: place.place_id ?? placeId,
                name: place.name ?? "",
                formatted_address: place.formatted_address ?? "",
                geometry: {
                  lat: place.geometry?.location?.lat() ?? 0,
                  lng: place.geometry?.location?.lng() ?? 0
                }
              });
            } else {
              resolve(null);
            }
          }
        );
      }),
    []
  );

  const clearPredictions = useCallback(() => {
    setPredictions([]);
    setNoResults(false);
  }, []);

  return {
    predictions,
    fetchPredictions,
    getPlaceDetails,
    clearPredictions,
    loading,
    enabled: !!API_KEY,
    ready,
    error,
    noResults
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

export type { PlacePrediction, PlaceDetails };
