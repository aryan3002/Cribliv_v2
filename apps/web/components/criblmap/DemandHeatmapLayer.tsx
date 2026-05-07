"use client";

import { useEffect, useRef } from "react";
import { useMapState } from "./hooks/useMapState";

interface DemandHeatmapLayerProps {
  map: google.maps.Map | null;
}

/**
 * Google Maps Visualization heatmap layer driven by seeker pin density.
 * Only visible when demand view is active.
 */
export function DemandHeatmapLayer({ map }: DemandHeatmapLayerProps) {
  const { seekerPins, demandViewActive } = useMapState();
  const heatmapRef = useRef<google.maps.visualization.HeatmapLayer | null>(null);

  useEffect(() => {
    // Clean up previous heatmap
    if (heatmapRef.current) {
      heatmapRef.current.setMap(null);
      heatmapRef.current = null;
    }

    if (
      !map ||
      !demandViewActive ||
      seekerPins.length === 0 ||
      typeof google === "undefined" ||
      !google.maps.visualization
    ) {
      return;
    }

    const points = seekerPins.map((pin) => ({
      location: new google.maps.LatLng(pin.lat, pin.lng),
      // Weight by budget — higher budget = hotter area
      weight: Math.max(1, pin.budget_max / 10000)
    }));

    heatmapRef.current = new google.maps.visualization.HeatmapLayer({
      data: points,
      map,
      radius: 40,
      opacity: 0.6,
      gradient: [
        "rgba(0, 0, 0, 0)",
        "rgba(8, 145, 178, 0.2)", // teal (seeker brand color)
        "rgba(8, 145, 178, 0.4)",
        "rgba(6, 182, 212, 0.6)",
        "rgba(34, 197, 94, 0.7)", // green transition
        "rgba(250, 204, 21, 0.8)", // yellow
        "rgba(249, 115, 22, 0.9)", // orange
        "rgba(239, 68, 68, 1)" // red = hottest demand
      ]
    });

    return () => {
      if (heatmapRef.current) {
        heatmapRef.current.setMap(null);
        heatmapRef.current = null;
      }
    };
  }, [map, seekerPins, demandViewActive]);

  return null;
}
