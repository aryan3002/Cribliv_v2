"use client";

import { useEffect, useRef, useCallback } from "react";
import { useMapState, useMapDispatch, type MapViewport } from "./hooks/useMapState";

interface AreaSelectOverlayProps {
  map: google.maps.Map | null;
}

export function AreaSelectOverlay({ map }: AreaSelectOverlayProps) {
  const { drawMode, drawnBounds } = useMapState();
  const dispatch = useMapDispatch();
  const rectRef = useRef<google.maps.Rectangle | null>(null);
  const markerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const firstCornerRef = useRef<{ lat: number; lng: number } | null>(null);
  const listenerRef = useRef<google.maps.MapsEventListener | null>(null);

  const clearOverlay = useCallback(() => {
    if (rectRef.current) {
      rectRef.current.setMap(null);
      rectRef.current = null;
    }
    if (markerRef.current) {
      markerRef.current.map = null;
      markerRef.current = null;
    }
    firstCornerRef.current = null;
  }, []);

  const drawRect = useCallback(
    (bounds: MapViewport) => {
      if (!map) return;
      if (rectRef.current) rectRef.current.setMap(null);

      rectRef.current = new google.maps.Rectangle({
        map,
        bounds: {
          south: Math.min(bounds.sw_lat, bounds.ne_lat),
          west: Math.min(bounds.sw_lng, bounds.ne_lng),
          north: Math.max(bounds.sw_lat, bounds.ne_lat),
          east: Math.max(bounds.sw_lng, bounds.ne_lng)
        },
        strokeColor: "#0066ff",
        strokeWeight: 2,
        strokeOpacity: 0.8,
        fillColor: "#0066ff",
        fillOpacity: 0.12,
        editable: true,
        draggable: true,
        zIndex: 100
      });

      rectRef.current.addListener("bounds_changed", () => {
        const b = rectRef.current?.getBounds();
        if (!b) return;
        const sw = b.getSouthWest();
        const ne = b.getNorthEast();
        dispatch({
          type: "COMPLETE_DRAW",
          bounds: {
            sw_lat: sw.lat(),
            sw_lng: sw.lng(),
            ne_lat: ne.lat(),
            ne_lng: ne.lng()
          }
        });
      });
    },
    [map, dispatch]
  );

  useEffect(() => {
    if (!map || drawMode === "idle") {
      listenerRef.current?.remove();
      listenerRef.current = null;
      if (drawMode === "idle") clearOverlay();
      return;
    }

    if (drawMode === "first-corner") {
      map.setOptions({ draggableCursor: "crosshair" });

      listenerRef.current = map.addListener("click", (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return;
        const lat = e.latLng.lat();
        const lng = e.latLng.lng();

        if (!firstCornerRef.current) {
          firstCornerRef.current = { lat, lng };
          dispatch({ type: "SET_FIRST_CORNER", lat, lng });

          const el = document.createElement("div");
          el.className = "cmap-draw-corner";
          markerRef.current = new google.maps.marker.AdvancedMarkerElement({
            map,
            position: { lat, lng },
            content: el,
            zIndex: 200
          });
        } else {
          const c = firstCornerRef.current;
          const bounds: MapViewport = {
            sw_lat: Math.min(c.lat, lat),
            sw_lng: Math.min(c.lng, lng),
            ne_lat: Math.max(c.lat, lat),
            ne_lng: Math.max(c.lng, lng)
          };

          if (markerRef.current) {
            markerRef.current.map = null;
            markerRef.current = null;
          }

          drawRect(bounds);
          dispatch({ type: "COMPLETE_DRAW", bounds });
          listenerRef.current?.remove();
          listenerRef.current = null;
          map.setOptions({ draggableCursor: null });
        }
      });
    }

    return () => {
      listenerRef.current?.remove();
      listenerRef.current = null;
      map.setOptions({ draggableCursor: null });
    };
  }, [map, drawMode, dispatch, clearOverlay, drawRect]);

  // Sync rectangle when drawnBounds changes externally (e.g., drag)
  useEffect(() => {
    if (drawMode === "complete" && drawnBounds && !rectRef.current) {
      drawRect(drawnBounds);
    }
  }, [drawMode, drawnBounds, drawRect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => clearOverlay();
  }, [clearOverlay]);

  return null;
}
