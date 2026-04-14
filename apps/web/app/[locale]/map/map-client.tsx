"use client";

import { MapStateProvider, type MapFilters } from "../../../components/criblmap/hooks/useMapState";
import { MapView } from "./map-view";

interface MapClientProps {
  locale: string;
  initialFilters?: MapFilters;
}

export default function MapClient({ locale, initialFilters }: MapClientProps) {
  return (
    <MapStateProvider initialFilters={initialFilters}>
      <MapView locale={locale} />
    </MapStateProvider>
  );
}
