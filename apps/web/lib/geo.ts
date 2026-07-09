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

// Web Mercator helpers for the homepage hero: project real listing
// coordinates onto a static map image with known geographic bounds, and
// derive those bounds deterministically from a center + zoom so the
// backdrop image and the pin layer can never drift apart.

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface GeoBounds {
  sw: GeoPoint;
  ne: GeoPoint;
}

// Mercator y for a latitude in degrees (unscaled; monotonic in lat).
function mercY(lat: number): number {
  return Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
}

export function projectToBounds(
  lat: number,
  lng: number,
  bounds: GeoBounds
): { xPct: number; yPct: number } {
  const xPct = ((lng - bounds.sw.lng) / (bounds.ne.lng - bounds.sw.lng)) * 100;
  const yPct =
    ((mercY(bounds.ne.lat) - mercY(lat)) / (mercY(bounds.ne.lat) - mercY(bounds.sw.lat))) * 100;
  return { xPct, yPct };
}

export function centroidOf(points: GeoPoint[]): GeoPoint | null {
  if (points.length === 0) return null;
  const sum = points.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), {
    lat: 0,
    lng: 0
  });
  return { lat: sum.lat / points.length, lng: sum.lng / points.length };
}

// World-pixel helpers at a given zoom (256px base tile).
function worldSize(zoom: number): number {
  return 256 * 2 ** zoom;
}

function lngToWorldX(lng: number, zoom: number): number {
  return ((lng + 180) / 360) * worldSize(zoom);
}

function latToWorldY(lat: number, zoom: number): number {
  const rad = (lat * Math.PI) / 180;
  const n = Math.log(Math.tan(rad) + 1 / Math.cos(rad));
  return ((1 - n / Math.PI) / 2) * worldSize(zoom);
}

function worldYToLat(y: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * y) / worldSize(zoom);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function worldXToLng(x: number, zoom: number): number {
  return (x / worldSize(zoom)) * 360 - 180;
}

export function boundsFromCenterZoom(
  center: GeoPoint,
  zoom: number,
  widthPx: number,
  heightPx: number
): GeoBounds {
  const cx = lngToWorldX(center.lng, zoom);
  const cy = latToWorldY(center.lat, zoom);
  return {
    sw: { lat: worldYToLat(cy + heightPx / 2, zoom), lng: worldXToLng(cx - widthPx / 2, zoom) },
    ne: { lat: worldYToLat(cy - heightPx / 2, zoom), lng: worldXToLng(cx + widthPx / 2, zoom) }
  };
}

export function zoomToFitBounds(
  bounds: GeoBounds,
  widthPx: number,
  heightPx: number,
  maxZoom = 15
): number {
  const center: GeoPoint = {
    lat: (bounds.sw.lat + bounds.ne.lat) / 2,
    lng: (bounds.sw.lng + bounds.ne.lng) / 2
  };
  for (let z = maxZoom; z >= 1; z--) {
    const img = boundsFromCenterZoom(center, z, widthPx, heightPx);
    if (
      img.sw.lat <= bounds.sw.lat &&
      img.ne.lat >= bounds.ne.lat &&
      img.sw.lng <= bounds.sw.lng &&
      img.ne.lng >= bounds.ne.lng
    ) {
      return z;
    }
  }
  return 1;
}
