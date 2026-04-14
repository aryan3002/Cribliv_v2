"use client";

import { useEffect, useRef } from "react";
import { useMapState } from "./hooks/useMapState";
import { useMetroData } from "./hooks/useMetroData";

interface MetroOverlayLayerProps {
  map: google.maps.Map | null;
}

export function MetroOverlayLayer({ map }: MetroOverlayLayerProps) {
  const { metroVisible } = useMapState();
  const { lines, loading } = useMetroData();
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);

  useEffect(() => {
    // Clear existing overlays
    for (const pl of polylinesRef.current) pl.setMap(null);
    for (const m of markersRef.current) m.map = null;
    polylinesRef.current = [];
    markersRef.current = [];

    if (!map || !metroVisible || loading || lines.length === 0) return;

    for (const line of lines) {
      const path = line.stations.map((s) => ({ lat: s.lat, lng: s.lng }));

      const polyline = new google.maps.Polyline({
        map,
        path,
        strokeColor: line.line_color,
        strokeWeight: 3,
        strokeOpacity: 0.85,
        zIndex: 50
      });
      polylinesRef.current.push(polyline);

      for (const station of line.stations) {
        const el = document.createElement("div");
        el.className = "cmap-metro-dot";
        el.style.setProperty("--line-color", line.line_color);
        el.title = station.name;

        const marker = new google.maps.marker.AdvancedMarkerElement({
          map,
          position: { lat: station.lat, lng: station.lng },
          content: el,
          zIndex: 55
        });

        marker.addListener("click", () => {
          const infoEl = document.createElement("div");
          infoEl.className = "cmap-metro-tooltip";
          infoEl.innerHTML = `
            <span class="cmap-metro-tooltip__line" style="background: ${line.line_color}"></span>
            <span>${station.name}</span>
            <span class="cmap-metro-tooltip__line-name">${line.line_name}</span>
          `;

          const popup = new google.maps.InfoWindow({
            content: infoEl,
            position: { lat: station.lat, lng: station.lng }
          });
          popup.open(map);
          setTimeout(() => popup.close(), 3000);
        });

        markersRef.current.push(marker);
      }
    }

    return () => {
      for (const pl of polylinesRef.current) pl.setMap(null);
      for (const m of markersRef.current) m.map = null;
      polylinesRef.current = [];
      markersRef.current = [];
    };
  }, [map, metroVisible, lines, loading]);

  return null;
}
