"use client";

import { useEffect, useRef } from "react";
import { useMapState, useMapDispatch } from "./useMapState";
import { fetchApi, buildSearchQuery } from "../../../lib/api";
import type { AreaStatsData } from "./useMapState";

export function useAreaStats() {
  const { drawnBounds, drawMode } = useMapState();
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
      ne_lng: drawnBounds.ne_lng
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
  }, [drawnBounds, drawMode, dispatch]);
}
