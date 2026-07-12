"use client";

import { useEffect, useRef, useState } from "react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { CRIBLMAP_DARK_STYLE } from "./map-styles";

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
// "DEMO_MAP_ID" enables AdvancedMarkerElement in dev without a Cloud Map ID.
// In production, set NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID to a real Cloud Map ID.
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? "DEMO_MAP_ID";

let mapsReady: Promise<void> | null = null;

// Google signals an auth/authorization failure (e.g. RefererNotAllowedMapError,
// InvalidKeyMapError, billing/quota) NOT by rejecting the loader promise but by
// invoking the global `window.gm_authFailure` and painting its own raw
// "Sorry! Something went wrong" overlay into the map div. Without a handler the
// app can't detect this, so on origins missing from the key's referrer allowlist
// (notably real mobile devices hitting the deployed domain) users see Google's
// ugly overlay instead of our styled fallback. Track the failure so map
// components can fall back gracefully.
let mapsAuthFailed = false;
const authFailureSubscribers = new Set<() => void>();

function markMapsAuthFailed() {
  if (mapsAuthFailed) return;
  mapsAuthFailed = true;
  for (const cb of authFailureSubscribers) cb();
}

export function mapsAuthHasFailed(): boolean {
  return mapsAuthFailed;
}

export function subscribeMapsAuthFailure(cb: () => void): () => void {
  authFailureSubscribers.add(cb);
  return () => {
    authFailureSubscribers.delete(cb);
  };
}

function ensureMapsLoaded(): Promise<void> {
  if (!API_KEY) return Promise.resolve();
  if (!mapsReady) {
    // Must be registered before the Maps script executes so Google can call it.
    if (typeof window !== "undefined") {
      (window as unknown as { gm_authFailure?: () => void }).gm_authFailure = markMapsAuthFailed;
    }
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
    colorScheme?: "DARK" | "LIGHT";
  } = {}
) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const [ready, setReady] = useState(false);

  const {
    center = { lat: 28.6139, lng: 77.209 },
    zoom = 11,
    styles,
    mapId = MAP_ID,
    colorScheme = "DARK"
  } = options;

  useEffect(() => {
    if (!API_KEY || !containerRef.current) return;

    let cancelled = false;
    ensureMapsLoaded().then(() => {
      if (cancelled || !containerRef.current) return;
      if (typeof google === "undefined") return;

      const googleColorScheme = (
        google.maps as unknown as {
          ColorScheme?: { DARK: string; LIGHT: string };
        }
      ).ColorScheme;
      const resolvedMapId = mapId?.trim() ? mapId : undefined;
      const mapOptions: google.maps.MapOptions & { colorScheme?: string } = {
        center,
        zoom,
        disableDefaultUI: true,
        zoomControl: true,
        zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_BOTTOM },
        gestureHandling: "greedy",
        clickableIcons: false,
        minZoom: 8,
        maxZoom: 19,
        styles: resolvedMapId ? undefined : (styles ?? CRIBLMAP_DARK_STYLE),
        ...(resolvedMapId ? { mapId: resolvedMapId } : {}),
        colorScheme:
          colorScheme === "LIGHT"
            ? (googleColorScheme?.LIGHT ?? "LIGHT")
            : (googleColorScheme?.DARK ?? "DARK")
      };

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
