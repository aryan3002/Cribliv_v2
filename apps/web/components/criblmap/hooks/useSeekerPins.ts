"use client";

import { useEffect, useRef, useCallback } from "react";
import { useMapState, useMapDispatch, type SeekerPin } from "./useMapState";
import { fetchApi, buildSearchQuery } from "../../../lib/api";

export function useSeekerPins() {
  const { viewport, demandViewActive } = useMapState();
  const dispatch = useMapDispatch();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const abortRef = useRef<AbortController>();

  const fetchSeekers = useCallback(async () => {
    if (!viewport || !demandViewActive) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const params = buildSearchQuery({
        sw_lat: viewport.sw_lat,
        sw_lng: viewport.sw_lng,
        ne_lat: viewport.ne_lat,
        ne_lng: viewport.ne_lng
      });

      const data = await fetchApi<SeekerPin[]>(`/map/seekers?${params}`, {
        signal: controller.signal
      });

      if (!controller.signal.aborted) {
        dispatch({ type: "SET_SEEKER_PINS", pins: data });
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
  }, [viewport, demandViewActive, dispatch]);

  useEffect(() => {
    if (!demandViewActive) {
      dispatch({ type: "SET_SEEKER_PINS", pins: [] });
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchSeekers, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchSeekers, demandViewActive]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);
}
