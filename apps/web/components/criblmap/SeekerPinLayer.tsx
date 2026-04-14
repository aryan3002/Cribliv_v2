"use client";

import { useEffect, useRef } from "react";
import { useMapState, type SeekerPin } from "./hooks/useMapState";

interface SeekerPinLayerProps {
  map: google.maps.Map | null;
}

function formatBudget(max: number): string {
  if (max >= 100000) return `${(max / 100000).toFixed(1)}L`;
  if (max >= 1000) return `${Math.round(max / 1000)}K`;
  return String(max);
}

function getSeekerLabel(pin: SeekerPin): string {
  const bhk =
    pin.bhk_preference?.length > 0 ? pin.bhk_preference.map((b) => `${b}BHK`).join("/") : "Any";
  const timing = pin.move_in === "immediate" ? "ASAP" : pin.move_in === "within_month" ? "1mo" : "";
  return `Looking · ₹${formatBudget(pin.budget_max)} · ${bhk}${timing ? ` · ${timing}` : ""}`;
}

export function SeekerPinLayer({ map }: SeekerPinLayerProps) {
  const { seekerPins, demandViewActive } = useMapState();
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);

  useEffect(() => {
    for (const m of markersRef.current) m.map = null;
    markersRef.current = [];

    if (!map || !demandViewActive || seekerPins.length === 0) return;

    for (const pin of seekerPins) {
      const el = document.createElement("div");
      el.className = "cmap-seeker-pin";
      el.innerHTML = `<span class="cmap-seeker-pin__label">${getSeekerLabel(pin)}</span>`;

      if (pin.note) {
        el.title = pin.note;
      }

      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat: pin.lat, lng: pin.lng },
        content: el,
        zIndex: 8
      });

      markersRef.current.push(marker);
    }

    return () => {
      for (const m of markersRef.current) m.map = null;
      markersRef.current = [];
    };
  }, [map, seekerPins, demandViewActive]);

  return null;
}
