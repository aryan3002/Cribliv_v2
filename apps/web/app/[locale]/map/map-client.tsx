"use client";

import { MapStateProvider, type MapFilters } from "../../../components/criblmap/hooks/useMapState";
import { MapView } from "./map-view";

interface MapClientProps {
  locale: string;
  initialFilters?: MapFilters;
  initialCenter?: { lat: number; lng: number };
  initialZoom?: number;
  initialCity?: string;
}

export default function MapClient({
  locale,
  initialFilters,
  initialCenter,
  initialZoom,
  initialCity
}: MapClientProps) {
  return (
    <MapStateProvider initialFilters={initialFilters} initialCity={initialCity}>
      <MapView locale={locale} initialCenter={initialCenter} initialZoom={initialZoom} />
    </MapStateProvider>
  );
}
