"use client";

import { useEffect, useRef, useCallback } from "react";
import { useMapState, useMapDispatch, type MapPin, type MapViewport } from "./useMapState";
import { fetchApi, buildSearchQuery } from "../../../lib/api";

interface MapPinResponse {
  id: string;
  lat: number;
  lng: number;
  title: string;
  monthly_rent: number;
  listing_type: string;
  bhk: number | null;
  verification_status: string;
  furnishing: string | null;
  cover_photo: string | null;
  city: string;
  locality: string | null;
  locality_slug: string | null;
}

function expandViewport(viewport: MapViewport, ratio = 0.18): MapViewport {
  const latPad = (viewport.ne_lat - viewport.sw_lat) * ratio;
  const lngPad = (viewport.ne_lng - viewport.sw_lng) * ratio;
  return {
    sw_lat: viewport.sw_lat - latPad,
    sw_lng: viewport.sw_lng - lngPad,
    ne_lat: viewport.ne_lat + latPad,
    ne_lng: viewport.ne_lng + lngPad
  };
}

function roundCoord(value: number): number {
  return Number(value.toFixed(5));
}

export function useMapPins() {
  const { viewport, filters } = useMapState();
  const dispatch = useMapDispatch();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const abortRef = useRef<AbortController>();
  const lastQueryRef = useRef<string | null>(null);

  const fetchPins = useCallback(async () => {
    if (!viewport) return;

    const queryViewport = expandViewport(viewport);
    const params: Record<string, string | number | boolean | undefined> = {
      sw_lat: roundCoord(queryViewport.sw_lat),
      sw_lng: roundCoord(queryViewport.sw_lng),
      ne_lat: roundCoord(queryViewport.ne_lat),
      ne_lng: roundCoord(queryViewport.ne_lng),
      limit: 500,
      ...(filters.bhk && { bhk: filters.bhk }),
      ...(filters.max_rent && { max_rent: filters.max_rent }),
      ...(filters.listing_type && { listing_type: filters.listing_type }),
      ...(filters.verified_only && { verified_only: "true" }),
      ...(filters.near_metro && { near_metro: "true" })
    };
    const query = buildSearchQuery(params);
    if (query === lastQueryRef.current) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    lastQueryRef.current = query;

    dispatch({ type: "SET_LOADING", isLoading: true });

    try {
      const data = await fetchApi<MapPinResponse[]>(`/listings/search/map?${query}`, {
        signal: controller.signal
      });

      if (controller.signal.aborted) return;

      const avgRent =
        data.length > 0 ? data.reduce((sum, p) => sum + p.monthly_rent, 0) / data.length : 0;

      const pins: MapPin[] = data.map((p) => ({
        ...p,
        belowMarket: avgRent > 0 && p.monthly_rent < avgRent * 0.85
      }));

      dispatch({ type: "SET_PINS", pins });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      lastQueryRef.current = null;
      dispatch({ type: "SET_LOADING", isLoading: false });
    }
  }, [viewport, filters, dispatch]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchPins, 260);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchPins]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);
}
