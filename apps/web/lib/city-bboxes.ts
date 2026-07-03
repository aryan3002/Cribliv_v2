/**
 * Rough bounding boxes for each city Cribliv supports. Used to derive the
 * "current city" from the map's center as the user pans / searches across
 * cities, so city-aware overlays (metro lines, area stats, etc.) can update
 * automatically without a URL change.
 *
 * The boxes intentionally err on the generous side — they're for "what city
 * is the user looking at right now?" not for precise jurisdictional answers.
 * Adjacent NCR cities (Gurugram / Noida / Ghaziabad / Faridabad) are kept
 * distinct so each can have its own metro / stats data later.
 */

export interface CityBBox {
  sw: { lat: number; lng: number };
  ne: { lat: number; lng: number };
}

export const CITY_BBOXES: Record<string, CityBBox> = {
  delhi: {
    sw: { lat: 28.4, lng: 76.84 },
    ne: { lat: 28.88, lng: 77.35 }
  },
  gurugram: {
    sw: { lat: 28.35, lng: 76.84 },
    ne: { lat: 28.55, lng: 77.13 }
  },
  noida: {
    sw: { lat: 28.4, lng: 77.3 },
    ne: { lat: 28.65, lng: 77.55 }
  },
  ghaziabad: {
    sw: { lat: 28.6, lng: 77.35 },
    ne: { lat: 28.78, lng: 77.55 }
  },
  faridabad: {
    sw: { lat: 28.3, lng: 77.25 },
    ne: { lat: 28.5, lng: 77.42 }
  },
  chandigarh: {
    sw: { lat: 30.65, lng: 76.7 },
    ne: { lat: 30.82, lng: 76.86 }
  },
  jaipur: {
    sw: { lat: 26.78, lng: 75.7 },
    ne: { lat: 27.01, lng: 75.93 }
  },
  lucknow: {
    sw: { lat: 26.7, lng: 80.8 },
    ne: { lat: 26.95, lng: 81.1 }
  }
};

export function cityCentroid(slug: string): { lat: number; lng: number } | null {
  const bbox = CITY_BBOXES[slug.toLowerCase()];
  if (!bbox) return null;
  return {
    lat: (bbox.sw.lat + bbox.ne.lat) / 2,
    lng: (bbox.sw.lng + bbox.ne.lng) / 2
  };
}

function inBBox(lat: number, lng: number, bbox: CityBBox): boolean {
  return lat >= bbox.sw.lat && lat <= bbox.ne.lat && lng >= bbox.sw.lng && lng <= bbox.ne.lng;
}

/**
 * Return the city slug whose bbox contains the given coordinate, or `null`
 * if no known city matches. Callers should KEEP their previous city when
 * this returns null (e.g. while the user is panning between cities) rather
 * than clobbering it with a default.
 */
export function detectCityFromCoord(lat: number, lng: number): string | null {
  for (const [slug, bbox] of Object.entries(CITY_BBOXES)) {
    if (inBBox(lat, lng, bbox)) return slug;
  }
  return null;
}
