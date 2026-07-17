"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_KEY, ensureMapsLoaded } from "./google-maps";

/**
 * Lightweight Google Places Autocomplete hook.
 *
 * Requires `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` to be set. When the key is absent
 * the hook is a no-op (`enabled: false`, empty predictions).
 *
 * New Places API
 * --------------
 * This hook uses the *new* Places API — `AutocompleteSuggestion` for
 * predictions and `Place` for details — NOT the legacy
 * `AutocompleteService`/`PlacesService`. Google sunset the legacy Places API:
 * projects that never enabled it get `REQUEST_DENIED` on every
 * `getPlacePredictions`/`getDetails` call, which made the locality field look
 * dead (no dropdown, no pin). The new API is served on the same key and is the
 * supported path going forward. Predictions and the subsequent details lookup
 * share an `AutocompleteSessionToken` so the pair is billed as one session; the
 * token is retired after a selection resolves.
 *
 * Resilience contract
 * -------------------
 *   - `ready`     — the service finished initializing and can take queries.
 *   - `error`     — "unavailable" (loader/authorize failure) or
 *                   "request_failed" (a prediction request errored).
 *   - `noResults` — a completed request returned zero matches.
 * A query typed before the service is ready is queued and executed once it
 * initializes, so owners never lose the search they already typed.
 */

// Restrict suggestions to India
const REGION_CODES = ["in"];

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

/** The `places` namespace once the Maps JS API has loaded, or null. */
function placesNamespace(): any | null {
  if (typeof google === "undefined") return null;
  return (google.maps as any)?.places ?? null;
}

/** Coerce the new API's FormattableText | string | null into a plain string. */
function textOf(value: any): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value.toString === "function") return value.toString();
  return "";
}

export function useGooglePlaces(opts: UseGooglePlacesOptions = {}) {
  const { types = ["locality", "sublocality", "neighborhood"], debounce: debounceMs = 300 } = opts;
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<PlacesError | null>(null);
  const [noResults, setNoResults] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>();
  // The most recent query typed before the service was ready. Flushed once
  // initialization completes so an early search isn't lost.
  const pendingQueryRef = useRef<string | null>(null);
  const initRef = useRef(false);
  // Mirrors `ready` for use inside stable callbacks without re-creating them.
  const readyRef = useRef(false);
  // Shared across a keystroke-run + its details lookup so Google bills one
  // session. Retired (nulled) after a selection resolves.
  const sessionTokenRef = useRef<any>(null);
  // Place objects returned by the current predictions, keyed by placeId, so a
  // details lookup reuses the session-linked instance from `toPlace()`.
  const suggestionPlacesRef = useRef<Map<string, any>>(new Map());
  // Monotonic id so a slow in-flight request can't overwrite a newer one.
  const requestSeqRef = useRef(0);

  // Keep the caller's options current without destabilizing the callbacks —
  // consumers pass fresh array/number literals every render.
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
        const places = placesNamespace();
        if (!places?.AutocompleteSuggestion || !places?.Place) {
          setError("unavailable");
          return;
        }
        readyRef.current = true;
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setError("unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const runPrediction = useCallback(async (input: string) => {
    const places = placesNamespace();
    if (!readyRef.current || !places?.AutocompleteSuggestion) {
      // Service not ready yet — remember the query and run it after init.
      pendingQueryRef.current = input;
      return;
    }

    if (!sessionTokenRef.current && places.AutocompleteSessionToken) {
      sessionTokenRef.current = new places.AutocompleteSessionToken();
    }

    const seq = ++requestSeqRef.current;
    setLoading(true);

    const baseRequest: Record<string, unknown> = {
      input,
      includedRegionCodes: REGION_CODES
    };
    if (sessionTokenRef.current) baseRequest.sessionToken = sessionTokenRef.current;
    const typedRequest =
      typesRef.current && typesRef.current.length > 0
        ? { ...baseRequest, includedPrimaryTypes: typesRef.current }
        : baseRequest;

    try {
      let response: any;
      try {
        response = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions(typedRequest);
      } catch {
        // Some type combinations are rejected by the API. Retry unfiltered so
        // the field still works rather than going dead.
        response = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions(baseRequest);
      }

      // A newer query started while this one was in flight — discard.
      if (seq !== requestSeqRef.current) return;

      const raw: any[] = (response?.suggestions ?? [])
        .map((s: any) => s?.placePrediction)
        .filter(Boolean);

      suggestionPlacesRef.current.clear();
      const mapped: PlacePrediction[] = raw.map((p: any) => {
        try {
          if (typeof p.toPlace === "function") {
            suggestionPlacesRef.current.set(p.placeId, p.toPlace());
          }
        } catch {
          /* ignore — details will fall back to a fresh Place */
        }
        const description = textOf(p.text);
        return {
          place_id: p.placeId,
          description,
          structured_formatting: {
            main_text: textOf(p.mainText) || description,
            secondary_text: textOf(p.secondaryText)
          }
        };
      });

      setLoading(false);
      if (mapped.length > 0) {
        setPredictions(mapped);
        setNoResults(false);
        setError(null);
      } else {
        setPredictions([]);
        setNoResults(true);
        setError(null);
      }
    } catch {
      if (seq !== requestSeqRef.current) return;
      setLoading(false);
      setPredictions([]);
      setNoResults(false);
      setError("request_failed");
    }
  }, []);

  // Flush a query that was typed before the service finished initializing.
  useEffect(() => {
    if (!ready) return;
    const pending = pendingQueryRef.current;
    if (pending && pending.trim().length >= 2) {
      pendingQueryRef.current = null;
      void runPrediction(pending);
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
        void runPrediction(input);
      }, debounceRef.current);
    },
    [runPrediction]
  );

  const getPlaceDetails = useCallback(async (placeId: string): Promise<PlaceDetails | null> => {
    const places = placesNamespace();
    if (!places?.Place) return null;

    try {
      const place = suggestionPlacesRef.current.get(placeId) ?? new places.Place({ id: placeId });
      await place.fetchFields({
        fields: ["displayName", "formattedAddress", "location", "id"]
      });

      // A selection ends the autocomplete session — retire the token so the
      // next search starts a fresh one.
      sessionTokenRef.current = null;

      const location = place.location;
      const lat = typeof location?.lat === "function" ? location.lat() : (location?.lat ?? 0);
      const lng = typeof location?.lng === "function" ? location.lng() : (location?.lng ?? 0);

      return {
        place_id: place.id ?? placeId,
        name: textOf(place.displayName),
        formatted_address: place.formattedAddress ?? "",
        geometry: { lat, lng }
      };
    } catch {
      return null;
    }
  }, []);

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
