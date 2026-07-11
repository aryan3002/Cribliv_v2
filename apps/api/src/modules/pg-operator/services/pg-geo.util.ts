export type PgLocationSource = "exact" | "locality" | "city";

export interface PgMapPoint {
  lat: number;
  lng: number;
  source: PgLocationSource;
  label: string;
  city_slug: string;
  locality_slug: string | null;
}

export interface PgGeoRow {
  ll_lat: number | null;
  ll_lng: number | null;
  loc_lat: number | null;
  loc_lng: number | null;
  city_slug: string;
  locality_slug: string | null;
  city_name: string | null;
  locality_name: string | null;
}

const EPS = 1e-6;

export function resolvePgMapPoint(row: PgGeoRow): PgMapPoint | null {
  if (row.ll_lat == null || row.ll_lng == null) return null;
  const lat = Number(row.ll_lat);
  const lng = Number(row.ll_lng);
  // The locality-centroid fallback stores the centroid value verbatim, so exact
  // equality (within EPS) reliably means "locality", not "operator pin".
  const isLocalityCentroid =
    row.loc_lat != null &&
    row.loc_lng != null &&
    Math.abs(lat - Number(row.loc_lat)) < EPS &&
    Math.abs(lng - Number(row.loc_lng)) < EPS;
  return {
    lat,
    lng,
    source: isLocalityCentroid ? "locality" : "exact",
    label: [row.locality_name, row.city_name].filter(Boolean).join(", ") || row.city_slug,
    city_slug: row.city_slug,
    locality_slug: row.locality_slug
  };
}
