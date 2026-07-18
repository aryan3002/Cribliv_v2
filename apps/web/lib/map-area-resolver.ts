// Spoken place name -> camera target. No polygons exist in the data model,
// so a locality is a centroid + a synthesized zoom (radius proxy).
import { searchMapIndex, type MapSearchHit } from "./map-search-index";

export const RADIUS_ZOOM = { city: 11, locality: 14 } as const;

export interface AreaResolution {
  center: { lat: number; lng: number };
  zoom: number;
  hit: MapSearchHit;
  method: "city-bbox" | "locality-radius";
}

export function resolveArea(name: string): AreaResolution | null {
  const hits = searchMapIndex(name, 1);
  const hit = hits[0];
  if (!hit) return null;
  const isCity = hit.kind === "city";
  return {
    center: { lat: hit.lat, lng: hit.lng },
    zoom: isCity ? RADIUS_ZOOM.city : RADIUS_ZOOM.locality,
    hit,
    method: isCity ? "city-bbox" : "locality-radius"
  };
}
