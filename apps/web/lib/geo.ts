/**
 * Geo math utilities. Kept dependency-free so any component (map overlays,
 * tooltips, listing cards) can use them without pulling in a routing library.
 */

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle ("as the crow flies") distance between two coordinates in km.
 * For pedestrian / driving distance use the Distance Matrix endpoint instead —
 * Haversine is a fine approximation for "is this near?" UI hints.
 */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(sa));
}

/** Same as `haversineKm` but returns metres rounded to nearest int. */
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  return Math.round(haversineKm(a, b) * 1000);
}

/**
 * Format a metres value as a human-readable distance. Sub-km values shown
 * to the nearest 10 m, km values to one decimal.
 *   430  → "430 m"
 *   1250 → "1.3 km"
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    const rounded = Math.max(10, Math.round(meters / 10) * 10);
    return `${rounded} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}
