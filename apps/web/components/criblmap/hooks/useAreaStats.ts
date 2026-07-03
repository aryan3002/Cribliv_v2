"use client";

import { useEffect, useRef } from "react";
import { useMapState, useMapDispatch } from "./useMapState";
import { fetchApi, buildSearchQuery } from "../../../lib/api";
import type { AreaStatsData } from "./useMapState";

export function useAreaStats() {
  const { drawnBounds, drawMode, filters } = useMapState();
  const dispatch = useMapDispatch();
  const abortRef = useRef<AbortController>();

  useEffect(() => {
    if (drawMode !== "complete" || !drawnBounds) {
      dispatch({ type: "SET_AREA_STATS", stats: null });
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const params = buildSearchQuery({
      sw_lat: drawnBounds.sw_lat,
      sw_lng: drawnBounds.sw_lng,
      ne_lat: drawnBounds.ne_lat,
      ne_lng: drawnBounds.ne_lng,
      ...(filters.bhk && { bhk: filters.bhk }),
      ...(filters.max_rent && { max_rent: filters.max_rent }),
      ...(filters.listing_type && { listing_type: filters.listing_type }),
      ...(filters.verified_only && { verified_only: "true" }),
      ...(filters.near_metro && { near_metro: "true" })
    });

    fetchApi<AreaStatsData>(`/map/stats?${params}`, { signal: controller.signal })
      .then((stats) => {
        if (!controller.signal.aborted) {
          dispatch({ type: "SET_AREA_STATS", stats });
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
      });

    return () => controller.abort();
  }, [drawnBounds, drawMode, filters, dispatch]);
}
