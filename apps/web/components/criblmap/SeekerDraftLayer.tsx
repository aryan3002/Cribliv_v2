"use client";

import { useEffect, useRef } from "react";
import { useMapState, useMapDispatch } from "./hooks/useMapState";

interface SeekerDraftLayerProps {
  map: google.maps.Map | null;
}

const DRAFT_COLOR = "#7c3aed"; // brand purple — matches the seeker demand theme

/* AdvancedMarkerElement gives position as a LatLng (methods) while classic
 * Marker events give a LatLngLiteral — normalise both to plain numbers. */
function normalizeLatLng(
  pos: google.maps.LatLng | google.maps.LatLngLiteral | null | undefined
): { lat: number; lng: number } | null {
  if (!pos) return null;
  const lat = typeof pos.lat === "function" ? pos.lat() : pos.lat;
  const lng = typeof pos.lng === "function" ? pos.lng() : pos.lng;
  return typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null;
}

/* The draggable pin the seeker places before dropping a search pin. Renders a
 * grabbable marker plus a live radius circle while the Seek panel is open, so
 * the seeker can SEE and CHOOSE exactly where their pin lands instead of it
 * silently snapping to the map centre. Kept imperative (Google Maps) and
 * self-styled inline, mirroring SeekerPinLayer, so it needs no CSS. */
export function SeekerDraftLayer({ map }: SeekerDraftLayerProps) {
  const { panelContent, seekerDraft, seekerRadiusM } = useMapState();
  const dispatch = useMapDispatch();
  const active = panelContent.type === "seeker-form" && !!seekerDraft;

  const advMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const classicMarkerRef = useRef<google.maps.Marker | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);

  // Create the marker + circle when the Seek panel opens; tear down on close.
  // Keyed only on [map, active] so a drag or radius change updates the existing
  // objects (below) instead of destroying the marker mid-interaction.
  useEffect(() => {
    if (!map || !active || !seekerDraft) return;
    const pos = { lat: seekerDraft.lat, lng: seekerDraft.lng };

    const circle = new google.maps.Circle({
      map,
      center: pos,
      radius: seekerRadiusM,
      strokeColor: DRAFT_COLOR,
      strokeOpacity: 0.7,
      strokeWeight: 2,
      fillColor: DRAFT_COLOR,
      fillOpacity: 0.08,
      clickable: false,
      zIndex: 5
    });
    circleRef.current = circle;

    let removeMarker = () => {};
    const AdvCtor = google.maps.marker?.AdvancedMarkerElement;
    try {
      if (!AdvCtor) throw new Error("Advanced markers unavailable");
      const el = document.createElement("div");
      el.style.cursor = "grab";
      el.title = "Drag to set your search location";
      el.innerHTML = `
        <svg width="34" height="44" viewBox="0 0 34 44" fill="none" xmlns="http://www.w3.org/2000/svg"
             style="filter: drop-shadow(0 3px 5px rgba(0,0,0,0.35)); display:block;">
          <path d="M17 43C17 43 32 27.5 32 16C32 7.7157 25.2843 1 17 1C8.7157 1 2 7.7157 2 16C2 27.5 17 43 17 43Z"
                fill="${DRAFT_COLOR}" stroke="#ffffff" stroke-width="2.5"/>
          <circle cx="17" cy="16" r="5.5" fill="#ffffff"/>
        </svg>`;
      const marker = new AdvCtor({
        map,
        position: pos,
        content: el,
        zIndex: 9,
        gmpDraggable: true
      });
      marker.addListener("dragend", () => {
        const p = normalizeLatLng(marker.position);
        if (p) dispatch({ type: "SET_SEEKER_DRAFT_POSITION", lat: p.lat, lng: p.lng });
      });
      advMarkerRef.current = marker;
      removeMarker = () => {
        marker.map = null;
      };
    } catch {
      const marker = new google.maps.Marker({
        map,
        position: pos,
        draggable: true,
        zIndex: 9,
        title: "Drag to set your search location"
      });
      marker.addListener("dragend", (e: google.maps.MapMouseEvent) => {
        const p = normalizeLatLng(e.latLng);
        if (p) dispatch({ type: "SET_SEEKER_DRAFT_POSITION", lat: p.lat, lng: p.lng });
      });
      classicMarkerRef.current = marker;
      removeMarker = () => marker.setMap(null);
    }

    return () => {
      removeMarker();
      circle.setMap(null);
      advMarkerRef.current = null;
      classicMarkerRef.current = null;
      circleRef.current = null;
    };
    // seekerDraft/seekerRadiusM read once at creation; updates handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, active, dispatch]);

  // Keep the marker + circle centred on the draft when it moves (map tap, or
  // the dragend that just fired — a harmless no-op reposition to the same spot).
  useEffect(() => {
    if (!seekerDraft) return;
    const pos = { lat: seekerDraft.lat, lng: seekerDraft.lng };
    if (advMarkerRef.current) advMarkerRef.current.position = pos;
    if (classicMarkerRef.current) classicMarkerRef.current.setPosition(pos);
    if (circleRef.current) circleRef.current.setCenter(pos);
  }, [seekerDraft]);

  // Resize the circle live as the seeker changes the radius chip.
  useEffect(() => {
    if (circleRef.current) circleRef.current.setRadius(seekerRadiusM);
  }, [seekerRadiusM]);

  return null;
}
