"use client";

import { MapStateProvider, type MapFilters } from "../../../components/criblmap/hooks/useMapState";
import { MapView } from "./map-view";

interface MapClientProps {
  locale: string;
  initialFilters?: MapFilters;
  initialCenter?: { lat: number; lng: number };
  initialZoom?: number;
}

export default function MapClient({
  locale,
  initialFilters,
  initialCenter,
  initialZoom
}: MapClientProps) {
  return (
    <MapStateProvider initialFilters={initialFilters}>
      <MapView locale={locale} initialCenter={initialCenter} initialZoom={initialZoom} />
    </MapStateProvider>
  );
}
