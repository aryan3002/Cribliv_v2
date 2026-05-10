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
        // Wrap the dot + a hover/click tooltip in a single element so we
        // own the styling end-to-end (Google's InfoWindow forces white
        // chrome that's unreadable on the dark map). The tooltip is
        // anchored above the dot via CSS, fully on-brand, and is shown
        // on hover OR when the dot is clicked (.cmap-metro-station--active).
        const wrapper = document.createElement("div");
        wrapper.className = "cmap-metro-station";
        wrapper.style.setProperty("--line-color", line.line_color);
        wrapper.innerHTML = `
          <span class="cmap-metro-dot" aria-label="${station.name}"></span>
          <span class="cmap-metro-tooltip" role="tooltip">
            <span class="cmap-metro-tooltip__swatch" aria-hidden="true"></span>
            <span class="cmap-metro-tooltip__name">${station.name}</span>
            <span class="cmap-metro-tooltip__line-name">${line.line_name}</span>
          </span>
        `;

        const marker = new google.maps.marker.AdvancedMarkerElement({
          map,
          position: { lat: station.lat, lng: station.lng },
          content: wrapper,
          zIndex: 55
        });

        // Click pins the tooltip on for 3.2s (mobile-friendly: tap-to-reveal
        // since :hover doesn't fire on touch). Re-tapping any station resets
        // the timer on that station.
        let pinTimer: ReturnType<typeof setTimeout> | null = null;
        wrapper.addEventListener("click", (e) => {
          e.stopPropagation();
          wrapper.classList.add("cmap-metro-station--active");
          if (pinTimer) clearTimeout(pinTimer);
          pinTimer = setTimeout(() => {
            wrapper.classList.remove("cmap-metro-station--active");
          }, 3200);
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
