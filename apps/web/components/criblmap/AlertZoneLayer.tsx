"use client";

import { useEffect, useRef } from "react";
import { useMapState } from "./hooks/useMapState";

interface AlertZoneLayerProps {
  map: google.maps.Map | null;
}

export function AlertZoneLayer({ map }: AlertZoneLayerProps) {
  const { alertZones } = useMapState();
  const rectsRef = useRef<google.maps.Rectangle[]>([]);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);

  useEffect(() => {
    for (const r of rectsRef.current) r.setMap(null);
    for (const m of markersRef.current) m.map = null;
    rectsRef.current = [];
    markersRef.current = [];

    if (!map || alertZones.length === 0) return;

    for (const zone of alertZones) {
      try {
        const { sw_lat, sw_lng, ne_lat, ne_lng } = zone;
        if (sw_lat == null || sw_lng == null || ne_lat == null || ne_lng == null) continue;

        const rect = new google.maps.Rectangle({
          map,
          bounds: { south: sw_lat, west: sw_lng, north: ne_lat, east: ne_lng },
          strokeColor: "#f59e0b",
          strokeWeight: 2,
          strokeOpacity: 0.7,
          fillColor: "#f59e0b",
          fillOpacity: 0.08,
          clickable: false,
          zIndex: 40
        });
        rectsRef.current.push(rect);

        const centerLat = (sw_lat + ne_lat) / 2;
        const centerLng = (sw_lng + ne_lng) / 2;

        const el = document.createElement("div");
        el.className = "cmap-alert-zone-icon";
        el.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
        el.title = zone.label;

        const marker = new google.maps.marker.AdvancedMarkerElement({
          map,
          position: { lat: centerLat, lng: centerLng },
          content: el,
          zIndex: 45
        });
        markersRef.current.push(marker);
      } catch {
        continue;
      }
    }

    return () => {
      for (const r of rectsRef.current) r.setMap(null);
      for (const m of markersRef.current) m.map = null;
      rectsRef.current = [];
      markersRef.current = [];
    };
  }, [map, alertZones]);

  return null;
}
