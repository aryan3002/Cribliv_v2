"use client";

import { useEffect, useRef, useState } from "react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { CRIBLMAP_DARK_STYLE } from "./map-styles";

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
// "DEMO_MAP_ID" enables AdvancedMarkerElement in dev without a Cloud Map ID.
// In production, set NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID to a real Cloud Map ID.
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? "DEMO_MAP_ID";

let mapsReady: Promise<void> | null = null;

function ensureMapsLoaded(): Promise<void> {
  if (!API_KEY) return Promise.resolve();
  if (!mapsReady) {
    setOptions({ key: API_KEY, v: "weekly" });
    mapsReady = Promise.all([
      importLibrary("maps"),
      importLibrary("marker"),
      importLibrary("places"),
      importLibrary("visualization")
    ]).then(() => {});
  }
  return mapsReady;
}

export function useGoogleMap(
  containerRef: React.RefObject<HTMLDivElement | null>,
  options: {
    center?: { lat: number; lng: number };
    zoom?: number;
    styles?: google.maps.MapTypeStyle[];
    mapId?: string;
  } = {}
) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const [ready, setReady] = useState(false);

  const { center = { lat: 28.6139, lng: 77.209 }, zoom = 11, styles, mapId = MAP_ID } = options;

  // Use Cloud-based styling when a real Map ID is configured;
  // fall back to inline dark styles for dev / DEMO_MAP_ID.
  const useCloudStyle = mapId !== "DEMO_MAP_ID";

  useEffect(() => {
    if (!API_KEY || !containerRef.current) return;

    let cancelled = false;
    ensureMapsLoaded().then(() => {
      if (cancelled || !containerRef.current) return;
      if (typeof google === "undefined") return;

      const mapOptions: google.maps.MapOptions = {
        center,
        zoom,
        disableDefaultUI: true,
        zoomControl: true,
        zoomControlOptions: { position: google.maps.ControlPosition.LEFT_BOTTOM },
        gestureHandling: "greedy",
        clickableIcons: false,
        minZoom: 8,
        maxZoom: 19
      };

      if (useCloudStyle) {
        mapOptions.mapId = mapId;
      } else {
        // Apply dark style inline when no Cloud Map ID is available
        mapOptions.styles = styles ?? CRIBLMAP_DARK_STYLE;
        mapOptions.mapId = mapId; // still needed for AdvancedMarkerElement
      }

      const map = new google.maps.Map(containerRef.current, mapOptions);

      mapRef.current = map;
      setReady(true);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { map: mapRef.current, ready };
}

export { ensureMapsLoaded, API_KEY, MAP_ID };
