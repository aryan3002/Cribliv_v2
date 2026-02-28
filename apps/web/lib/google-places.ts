"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";

/**
 * Lightweight Google Places Autocomplete hook.
 *
 * Requires `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` to be set.
 * When the key is absent, the hook is a no-op (returns empty predictions).
 */

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

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

/* eslint-disable @typescript-eslint/no-explicit-any */

let placesReady: Promise<void> | null = null;

function ensurePlacesLoaded(): Promise<void> {
  if (!API_KEY) return Promise.resolve();
  if (!placesReady) {
    setOptions({ key: API_KEY, v: "weekly" });
    placesReady = importLibrary("places").then(() => {
      /* places namespace now available on window.google */
    });
  }
  return placesReady;
}

export function useGooglePlaces(opts: UseGooglePlacesOptions = {}) {
  const { types = ["locality", "sublocality", "neighborhood"], debounce: debounceMs = 300 } = opts;
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const serviceRef = useRef<any>(null);
  const placesServiceRef = useRef<any>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>();
  const initRef = useRef(false);

  // Load Google Maps JS API once
  useEffect(() => {
    if (!API_KEY || initRef.current) return;
    initRef.current = true;

    ensurePlacesLoaded().then(() => {
      if (typeof google === "undefined") return;
      serviceRef.current = new (google.maps.places as any).AutocompleteService();
      const div = document.createElement("div");
      placesServiceRef.current = new (google.maps.places as any).PlacesService(div);
    });
  }, []);

  const fetchPredictions = useCallback(
    (input: string) => {
      if (!API_KEY) {
        setPredictions([]);
        return;
      }
      if (debounceTimer.current) clearTimeout(debounceTimer.current);

      if (input.length < 2) {
        setPredictions([]);
        return;
      }

      debounceTimer.current = setTimeout(() => {
        if (!serviceRef.current) return;
        setLoading(true);
        serviceRef.current.getPlacePredictions(
          {
            input,
            componentRestrictions: COMPONENT_RESTRICTIONS,
            types
          },
          (results: any[] | null, status: string) => {
            setLoading(false);
            if (status === "OK" && results) {
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
            } else {
              setPredictions([]);
            }
          }
        );
      }, debounceMs);
    },
    [types, debounceMs]
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

  const clearPredictions = useCallback(() => setPredictions([]), []);

  return {
    predictions,
    fetchPredictions,
    getPlaceDetails,
    clearPredictions,
    loading,
    enabled: !!API_KEY
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

export type { PlacePrediction, PlaceDetails };
