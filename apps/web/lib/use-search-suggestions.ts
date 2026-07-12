"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchApi } from "./api";
import { useGooglePlaces, type PlacePrediction } from "./google-places";
import type { SearchSegment } from "./search-segment";

/**
 * A single suggestion from Cribliv's own suggest API (`/listings/search/suggest`
 * for Homes, `/pg/suggest` for PG). Shape mirrors the homepage hero's suggestions
 * so the two bars can converge on one presentation later.
 */
export interface CriblivSuggestion {
  type: "city" | "locality" | "listing";
  label: string;
  value: string;
  listing_count?: number;
  rent_band?: { min: number; max: number };
  city_slug?: string;
  cover_url?: string | null;
  rent?: number;
  verified?: boolean;
  locality_label?: string;
  posted_at?: string;
}

export type BlendedSuggestion =
  | { source: "cribliv"; data: CriblivSuggestion }
  | { source: "google"; data: PlacePrediction };

const DEBOUNCE_MS = 120;
const MIN_QUERY = 2;
const SUGGEST_LIMIT = 6;

/**
 * Autocomplete engine shared by search bars. Owns the debounced fetch of the
 * internal suggest API, Google Places blending, in-flight request aborting, and
 * open/close state (including click-outside). It is deliberately UI-agnostic: it
 * returns data + handlers, and the caller renders whatever dropdown it wants.
 *
 * Selection/navigation is intentionally NOT handled here — each surface routes
 * differently — so callers wire suggestion clicks to their own navigation.
 */
export function useSearchSuggestions(segment: SearchSegment) {
  const [suggestions, setSuggestions] = useState<BlendedSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const abortRef = useRef<AbortController | null>(null);

  const {
    predictions,
    fetchPredictions,
    clearPredictions,
    enabled: placesEnabled
  } = useGooglePlaces({ types: ["locality", "sublocality", "neighborhood"] });

  const fetchCribliv = useCallback(
    async (q: string, signal: AbortSignal): Promise<CriblivSuggestion[]> => {
      const path = segment === "pg" ? "/pg/suggest" : "/listings/search/suggest";
      try {
        const data = await fetchApi<CriblivSuggestion[]>(
          `${path}?q=${encodeURIComponent(q)}&limit=${SUGGEST_LIMIT}`,
          { signal }
        );
        // Defensive: an empty/DB-less API can return a non-array payload.
        return Array.isArray(data) ? data : [];
      } catch {
        // Aborted, network error, or non-2xx — treated as "no suggestions".
        return [];
      }
    },
    [segment]
  );

  const onQueryChange = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();

      if (value.trim().length < MIN_QUERY) {
        // Too short to query — drop live suggestions but stay open so a caller
        // showing recent searches can keep the panel visible.
        setSuggestions([]);
        clearPredictions();
        return;
      }

      setIsOpen(true);
      debounceRef.current = setTimeout(async () => {
        const controller = new AbortController();
        abortRef.current = controller;
        const [cribliv] = await Promise.all([
          fetchCribliv(value, controller.signal),
          placesEnabled ? fetchPredictions(value) : Promise.resolve()
        ]);
        if (controller.signal.aborted) return;
        setSuggestions(cribliv.map((data) => ({ source: "cribliv" as const, data })));
        setIsOpen(true);
      }, DEBOUNCE_MS);
    },
    [clearPredictions, fetchCribliv, fetchPredictions, placesEnabled]
  );

  // Google predictions arrive asynchronously; splice them in beside the Cribliv
  // rows without clobbering them.
  useEffect(() => {
    if (predictions.length === 0) return;
    setSuggestions((prev) => [
      ...prev.filter((s) => s.source === "cribliv"),
      ...predictions.map((data) => ({ source: "google" as const, data }))
    ]);
    setIsOpen(true);
  }, [predictions]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  return { suggestions, isOpen, containerRef, onQueryChange, open, close };
}
