"use client";

import { useEffect, useRef, useState } from "react";
import { Navigation, X } from "lucide-react";
import { useMapState, useMapDispatch } from "./hooks/useMapState";
import { useMetroData } from "./hooks/useMetroData";

interface CommuteOverlayProps {
  map: google.maps.Map | null;
  showInput: boolean;
  onCloseInput: () => void;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function CommuteOverlay({ map, showInput, onCloseInput }: CommuteOverlayProps) {
  const { commuteOrigin } = useMapState();
  const dispatch = useMapDispatch();
  const { lines } = useMetroData();
  const circlesRef = useRef<google.maps.Circle[]>([]);
  const originMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const [address, setAddress] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  useEffect(() => {
    if (!showInput || !inputRef.current || typeof google === "undefined") return;

    autocompleteRef.current = new google.maps.places.Autocomplete(inputRef.current, {
      types: ["establishment", "geocode"],
      componentRestrictions: { country: "in" }
    });

    autocompleteRef.current.addListener("place_changed", () => {
      const place = autocompleteRef.current?.getPlace();
      if (place?.geometry?.location) {
        const addr = place.formatted_address ?? place.name ?? "";
        setAddress(addr);
        dispatch({
          type: "SET_COMMUTE_ORIGIN",
          origin: {
            lat: place.geometry.location.lat(),
            lng: place.geometry.location.lng(),
            address: addr
          }
        });
        onCloseInput();
      }
    });
  }, [showInput, dispatch, onCloseInput]);

  useEffect(() => {
    for (const c of circlesRef.current) c.setMap(null);
    if (originMarkerRef.current) originMarkerRef.current.map = null;
    circlesRef.current = [];

    if (!map || !commuteOrigin) return;

    const el = document.createElement("div");
    el.className = "cmap-commute-origin";
    el.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="var(--brand)" stroke="white" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="white"/></svg>`;
    el.title = commuteOrigin.address;

    originMarkerRef.current = new google.maps.marker.AdvancedMarkerElement({
      map,
      position: { lat: commuteOrigin.lat, lng: commuteOrigin.lng },
      content: el,
      zIndex: 200
    });

    const reachableStations: { lat: number; lng: number }[] = [];
    for (const line of lines) {
      for (const station of line.stations) {
        const dist = haversineKm(commuteOrigin.lat, commuteOrigin.lng, station.lat, station.lng);
        if (dist <= 8) {
          reachableStations.push({ lat: station.lat, lng: station.lng });
        }
      }
    }

    for (const station of reachableStations) {
      const circle = new google.maps.Circle({
        map,
        center: station,
        radius: 1000,
        strokeColor: "#0066ff",
        strokeWeight: 1,
        strokeOpacity: 0.3,
        fillColor: "#0066ff",
        fillOpacity: 0.1,
        clickable: false,
        zIndex: 35
      });
      circlesRef.current.push(circle);
    }

    return () => {
      for (const c of circlesRef.current) c.setMap(null);
      if (originMarkerRef.current) originMarkerRef.current.map = null;
      circlesRef.current = [];
    };
  }, [map, commuteOrigin, lines]);

  return (
    <>
      {showInput && (
        <div className="cmap-commute-input">
          <Navigation size={16} />
          <input
            ref={inputRef}
            type="text"
            className="cmap-topbar__input"
            style={{ borderRadius: 8, paddingLeft: 12, flex: 1 }}
            placeholder="Enter your office address..."
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            autoFocus
          />
          <button className="cmap-panel__close" onClick={onCloseInput} aria-label="Close">
            <X size={14} />
          </button>
        </div>
      )}

      {commuteOrigin && !showInput && (
        <div className="cmap-commute-badge">
          <Navigation size={12} />
          <span>{commuteOrigin.address.split(",")[0]}</span>
          <button
            onClick={() => dispatch({ type: "SET_COMMUTE_ORIGIN", origin: null })}
            aria-label="Clear commute"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </>
  );
}
