"use client";

import { useEffect, useRef, useCallback } from "react";
import { useGoogleMap } from "../../lib/google-maps";
import { CRIBLMAP_LIGHT_STYLE } from "../../lib/map-styles";
import { detectCityFromCoord } from "../../lib/city-bboxes";
import { useMapDispatch, useMapState } from "./hooks/useMapState";

interface CriblMapCanvasProps {
  onMapReady?: (map: google.maps.Map) => void;
  mapRef?: React.MutableRefObject<google.maps.Map | null>;
  initialCenter?: { lat: number; lng: number };
  initialZoom?: number;
}

function roundViewportCoord(value: number): number {
  return Number(value.toFixed(5));
}

export function CriblMapCanvas({
  onMapReady,
  mapRef: externalMapRef,
  initialCenter,
  initialZoom
}: CriblMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { map, ready } = useGoogleMap(containerRef, {
    center: initialCenter ?? { lat: 28.6139, lng: 77.209 },
    zoom: initialZoom ?? 11,
    styles: CRIBLMAP_LIGHT_STYLE,
    colorScheme: "LIGHT"
  });
  const dispatch = useMapDispatch();
  const { city: currentCity } = useMapState();
  const currentCityRef = useRef(currentCity);
  useEffect(() => {
    currentCityRef.current = currentCity;
  }, [currentCity]);

  const listenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const viewportKeyRef = useRef<string | null>(null);

  const syncViewport = useCallback(() => {
    if (!map) return;
    const bounds = map.getBounds();
    if (!bounds) return;

    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const center = map.getCenter();
    const centerLatLng = center
      ? { lat: center.lat(), lng: center.lng() }
      : { lat: 28.6139, lng: 77.209 };
    const zoom = map.getZoom() ?? 11;
    const viewportKey = [
      roundViewportCoord(sw.lat()),
      roundViewportCoord(sw.lng()),
      roundViewportCoord(ne.lat()),
      roundViewportCoord(ne.lng()),
      zoom
    ].join(":");

    if (viewportKey === viewportKeyRef.current) return;
    viewportKeyRef.current = viewportKey;

    dispatch({
      type: "SET_VIEWPORT",
      viewport: {
        sw_lat: sw.lat(),
        sw_lng: sw.lng(),
        ne_lat: ne.lat(),
        ne_lng: ne.lng()
      },
      zoom,
      center: centerLatLng
    });

    // City auto-detection: when the map's center crosses into a different
    // known city's bbox, dispatch SET_CITY so city-aware overlays (metro
    // lines, etc.) re-fetch for the new city. If the center sits in
    // unknown territory (panning between cities, rural area), keep the
    // last known city rather than clobbering it.
    const detected = detectCityFromCoord(centerLatLng.lat, centerLatLng.lng);
    if (detected && detected !== currentCityRef.current) {
      dispatch({ type: "SET_CITY", city: detected });
    }
  }, [map, dispatch]);

  useEffect(() => {
    if (!map || !ready) return;

    if (externalMapRef) externalMapRef.current = map;
    onMapReady?.(map);

    listenerRef.current = map.addListener("idle", syncViewport);
    syncViewport();

    return () => {
      listenerRef.current?.remove();
    };
  }, [map, ready, syncViewport, onMapReady, externalMapRef]);

  return (
    <div
      ref={containerRef}
      className="criblmap-canvas"
      aria-label="CriblMap: Verified rental listings map"
    />
  );
}
