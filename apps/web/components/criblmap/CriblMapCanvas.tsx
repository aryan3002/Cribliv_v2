"use client";

import { useEffect, useRef, useCallback } from "react";
import { useGoogleMap } from "../../lib/google-maps";
import { useMapDispatch } from "./hooks/useMapState";

interface CriblMapCanvasProps {
  onMapReady?: (map: google.maps.Map) => void;
  mapRef?: React.MutableRefObject<google.maps.Map | null>;
}

export function CriblMapCanvas({ onMapReady, mapRef: externalMapRef }: CriblMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // styles are intentionally omitted — mapId (set in useGoogleMap) enables
  // AdvancedMarkerElement and is mutually exclusive with inline styles.
  // Dark styling should be configured in the Cloud Console Map ID for production.
  const { map, ready } = useGoogleMap(containerRef, {
    center: { lat: 28.6139, lng: 77.209 },
    zoom: 11
  });
  const dispatch = useMapDispatch();
  const listenerRef = useRef<google.maps.MapsEventListener | null>(null);

  const syncViewport = useCallback(() => {
    if (!map) return;
    const bounds = map.getBounds();
    if (!bounds) return;

    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const center = map.getCenter();

    dispatch({
      type: "SET_VIEWPORT",
      viewport: {
        sw_lat: sw.lat(),
        sw_lng: sw.lng(),
        ne_lat: ne.lat(),
        ne_lng: ne.lng()
      },
      zoom: map.getZoom() ?? 11,
      center: center ? { lat: center.lat(), lng: center.lng() } : { lat: 28.6139, lng: 77.209 }
    });
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
      aria-label="CriblMap — Verified rental listings map"
    />
  );
}
