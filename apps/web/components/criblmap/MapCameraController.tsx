"use client";
import { createContext, useContext, useCallback, useMemo, type ReactNode } from "react";
import type { CameraIntent } from "../../lib/map-intent-types";

export function applyCameraIntent(
  map: google.maps.Map | null,
  intent: CameraIntent,
  reduceMotion: boolean
): void {
  if (!map) return;
  if (intent.kind === "center") {
    map.panTo(intent.center);
    map.setZoom(intent.zoom);
    return;
  }
  const bounds = new google.maps.LatLngBounds(
    new google.maps.LatLng(intent.sw.lat, intent.sw.lng),
    new google.maps.LatLng(intent.ne.lat, intent.ne.lng)
  );
  map.fitBounds(bounds);
  void reduceMotion; // panTo/fitBounds are instant enough; hook left for future easing
}

interface CameraApi {
  flyTo: (intent: CameraIntent) => void;
}
const CameraContext = createContext<CameraApi>({ flyTo: () => {} });

export function MapCameraProvider({
  map,
  children
}: {
  map: google.maps.Map | null;
  children: ReactNode;
}) {
  const flyTo = useCallback(
    (intent: CameraIntent) => {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
      applyCameraIntent(map, intent, reduce);
    },
    [map]
  );
  const value = useMemo(() => ({ flyTo }), [flyTo]);
  return <CameraContext.Provider value={value}>{children}</CameraContext.Provider>;
}

export function useMapCamera(): CameraApi {
  return useContext(CameraContext);
}
