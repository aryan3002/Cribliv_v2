"use client";

import { useEffect, useRef } from "react";
import { useMapState } from "./hooks/useMapState";

interface Props {
  map: google.maps.Map | null;
}

/**
 * "Where Should I Live?" heatmap.
 *
 * Renders a translucent circle per reachable locality, coloured by the
 * commute fit against the user's max-minutes slider. Green = squarely
 * inside the budget; amber = within 1.2× (a "stretch" zone, useful when
 * a bargain pops up). Beyond 1.2× → not rendered (we don't want to paint
 * the entire city; the empty negative space is itself signal).
 */
export function CommuteReachabilityLayer({ map }: Props) {
  const { commuteReachability, commuteMaxMinutes } = useMapState();
  const circlesRef = useRef<google.maps.Circle[]>([]);

  useEffect(() => {
    for (const c of circlesRef.current) c.setMap(null);
    circlesRef.current = [];

    if (!map || !commuteReachability || commuteReachability.length === 0) return;

    const stretchMax = commuteMaxMinutes * 1.2;

    for (const loc of commuteReachability) {
      let color: string;
      let fillOpacity: number;
      let strokeOpacity: number;

      if (loc.total_minutes <= commuteMaxMinutes) {
        color = "#22c55e"; // green
        fillOpacity = 0.18;
        strokeOpacity = 0.55;
      } else if (loc.total_minutes <= stretchMax) {
        color = "#f59e0b"; // amber
        fillOpacity = 0.1;
        strokeOpacity = 0.4;
      } else {
        continue;
      }

      const circle = new google.maps.Circle({
        map,
        center: { lat: loc.lat, lng: loc.lng },
        radius: 800,
        strokeColor: color,
        strokeWeight: 1.5,
        strokeOpacity,
        fillColor: color,
        fillOpacity,
        clickable: false,
        zIndex: 6
      });
      circlesRef.current.push(circle);
    }

    return () => {
      for (const c of circlesRef.current) c.setMap(null);
      circlesRef.current = [];
    };
  }, [map, commuteReachability, commuteMaxMinutes]);

  return null;
}
