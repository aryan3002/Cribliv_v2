"use client";

import { useEffect, useRef, useMemo } from "react";
import { useMapState, useMapDispatch, type MapPin } from "./hooks/useMapState";

interface ListingPinLayerProps {
  map: google.maps.Map | null;
}

function formatRent(rent: number): string {
  if (rent >= 100000) return `${(rent / 100000).toFixed(1)}L`;
  if (rent >= 1000) return `${Math.round(rent / 1000)}K`;
  return String(rent);
}

function getPinLabel(pin: MapPin): string {
  const prefix = pin.listing_type === "pg" ? "PG" : pin.bhk ? `${pin.bhk}BHK` : "Flat";
  return `${prefix} · ₹${formatRent(pin.monthly_rent)}`;
}

function getPinClass(pin: MapPin, isSelected: boolean): string {
  let cls = "criblmap-pin";
  if (pin.listing_type === "pg") cls += " criblmap-pin--pg";
  else if (pin.verification_status === "verified") cls += " criblmap-pin--verified";
  else cls += " criblmap-pin--unverified";

  if (pin.belowMarket) cls += " criblmap-pin--below-market";
  if (isSelected) cls += " criblmap-pin--selected";
  return cls;
}

interface ClusterGroup {
  pins: MapPin[];
  lat: number;
  lng: number;
}

function clusterPins(pins: MapPin[], zoom: number): (MapPin | ClusterGroup)[] {
  if (zoom >= 14) return pins;

  const gridSize = zoom <= 10 ? 0.05 : 0.02;
  const clusters = new Map<string, ClusterGroup>();

  for (const pin of pins) {
    const key = `${Math.round(pin.lat / gridSize)}_${Math.round(pin.lng / gridSize)}`;
    const existing = clusters.get(key);
    if (existing) {
      existing.pins.push(pin);
      existing.lat = (existing.lat + pin.lat) / 2;
      existing.lng = (existing.lng + pin.lng) / 2;
    } else {
      clusters.set(key, { pins: [pin], lat: pin.lat, lng: pin.lng });
    }
  }

  const result: (MapPin | ClusterGroup)[] = [];
  for (const cluster of clusters.values()) {
    if (cluster.pins.length === 1) {
      result.push(cluster.pins[0]);
    } else {
      result.push(cluster);
    }
  }
  return result;
}

function isCluster(item: MapPin | ClusterGroup): item is ClusterGroup {
  return "pins" in item;
}

export function ListingPinLayer({ map }: ListingPinLayerProps) {
  const { pins, selectedPinId, zoom, demandViewActive } = useMapState();
  const dispatch = useMapDispatch();
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);

  const clustered = useMemo(() => clusterPins(pins, zoom), [pins, zoom]);

  useEffect(() => {
    if (!map || typeof google === "undefined") return;

    for (const m of markersRef.current) {
      m.map = null;
    }
    markersRef.current = [];

    for (const item of clustered) {
      const el = document.createElement("div");

      if (demandViewActive) {
        el.style.opacity = "0.3";
        el.style.transition = "opacity 0.3s ease";
      }

      if (isCluster(item)) {
        const verifiedCount = item.pins.filter((p) => p.verification_status === "verified").length;
        el.className = "criblmap-cluster";
        el.innerHTML = `<span class="criblmap-cluster__count">${item.pins.length}</span><span class="criblmap-cluster__label">${verifiedCount} verified</span>`;
      } else {
        const verified = item.verification_status === "verified";
        el.className = getPinClass(item, item.id === selectedPinId);
        el.innerHTML = `<span class="criblmap-pin__label">${getPinLabel(item)}</span>${verified ? '<span class="criblmap-pin__badge">✓</span>' : ""}`;
        el.addEventListener("click", () => {
          dispatch({ type: "SELECT_PIN", pinId: item.id });
        });
      }

      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: {
          lat: isCluster(item) ? item.lat : item.lat,
          lng: isCluster(item) ? item.lng : item.lng
        },
        content: el,
        zIndex: isCluster(item) ? 1 : item.id === selectedPinId ? 10 : 5
      });

      if (isCluster(item)) {
        marker.addListener("click", () => {
          map.setZoom((map.getZoom() ?? 11) + 2);
          map.panTo({ lat: item.lat, lng: item.lng });
        });
      }

      markersRef.current.push(marker);
    }

    return () => {
      for (const m of markersRef.current) {
        m.map = null;
      }
      markersRef.current = [];
    };
  }, [map, clustered, selectedPinId, dispatch, demandViewActive]);

  return null;
}
