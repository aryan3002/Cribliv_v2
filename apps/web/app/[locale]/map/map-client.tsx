"use client";

import { useEffect } from "react";
import { MapStateProvider, type MapFilters } from "../../../components/criblmap/hooks/useMapState";
import { MapView } from "./map-view";
import { track } from "../../../lib/track";

interface MapClientProps {
  locale: string;
  initialFilters?: MapFilters;
  initialCenter?: { lat: number; lng: number };
  initialZoom?: number;
  initialCity?: string;
  initialOriginatingListingId?: string | null;
  fromHero?: boolean;
}

export default function MapClient({
  locale,
  initialFilters,
  initialCenter,
  initialZoom,
  initialCity,
  initialOriginatingListingId,
  fromHero
}: MapClientProps) {
  // Strip the one-shot ?src=hero marker so reloads/shares are clean, and
  // record that a listening-hero handoff completed.
  useEffect(() => {
    if (!fromHero) return;
    track("hero_map_handoff", { had_locality: window.location.search.includes("lat=") });
    const url = new URL(window.location.href);
    url.searchParams.delete("src");
    window.history.replaceState(null, "", url.toString());
  }, [fromHero]);

  const mapTree = (
    <MapStateProvider
      initialFilters={initialFilters}
      initialCity={initialCity}
      initialOriginatingListingId={initialOriginatingListingId}
    >
      <MapView locale={locale} initialCenter={initialCenter} initialZoom={initialZoom} />
    </MapStateProvider>
  );

  // Only wrap in the fade-in element when arriving from the listening hero —
  // the normal map path (no wrapper) stays byte-identical in output.
  if (!fromHero) return mapTree;

  return <div className="map-entry--hero">{mapTree}</div>;
}
