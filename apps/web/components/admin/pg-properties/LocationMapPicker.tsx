"use client";

import { useEffect, useRef } from "react";
import { useGoogleMap } from "../../../lib/google-maps";

interface Props {
  lat: number | null;
  lng: number | null;
  /** When provided, the pin is draggable and map clicks move it (Phase 5 edit mode). */
  onChange?: (lat: number, lng: number) => void;
  height?: number;
}

const DEFAULT_CENTER = { lat: 26.8467, lng: 80.9462 }; // Lucknow fallback

/**
 * Google-Maps pin for the Location tab. Read-only preview by default; pass
 * `onChange` to make the marker draggable + clickable (admin geo edit).
 */
export function LocationMapPicker({ lat, lng, onChange, height = 240 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const markerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const hasPin = lat != null && lng != null;
  const center = hasPin ? { lat: lat as number, lng: lng as number } : DEFAULT_CENTER;
  const { map, ready } = useGoogleMap(containerRef, { center, zoom: hasPin ? 15 : 11 });

  // Place / update the marker when the map is ready or coords change.
  useEffect(() => {
    if (!ready || !map || typeof google === "undefined") return;
    const draggable = !!onChangeRef.current;

    if (!markerRef.current) {
      markerRef.current = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: center,
        gmpDraggable: draggable
      });
      if (draggable) {
        markerRef.current.addListener("dragend", (e: { latLng?: google.maps.LatLng }) => {
          const p = e.latLng;
          if (p) onChangeRef.current?.(p.lat(), p.lng());
        });
        map.addListener("click", (e: { latLng?: google.maps.LatLng }) => {
          const p = e.latLng;
          if (p && markerRef.current) {
            markerRef.current.position = p;
            onChangeRef.current?.(p.lat(), p.lng());
          }
        });
      }
    } else {
      markerRef.current.position = center;
    }
    if (hasPin) {
      map.setCenter(center);
    }
    // center is derived from lat/lng; depend on the primitives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, map, lat, lng]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height,
        borderRadius: 10,
        overflow: "hidden",
        border: "1px solid var(--ad-border)",
        background: "var(--ad-surface-2)"
      }}
    />
  );
}
