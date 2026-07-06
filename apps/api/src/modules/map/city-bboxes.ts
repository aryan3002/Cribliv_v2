/**
 * Server-side mirror of `apps/web/lib/city-bboxes.ts`. Used by the metro
 * endpoint to find lines whose stations physically reach into a given city,
 * even when those lines were seeded under another city slug (e.g. DMRC
 * Yellow Line is seeded as `city='delhi'` but its Sikanderpur..HUDA stretch
 * physically lies in Gurugram — when a user views Gurugram, we want the
 * full Yellow Line to render).
 *
 * Keep these boxes generous — they're for "what metro reaches this city?"
 * not for precise jurisdictional answers.
 */

export interface CityBBox {
  sw_lat: number;
  sw_lng: number;
  ne_lat: number;
  ne_lng: number;
}

export const CITY_BBOXES: Record<string, CityBBox> = {
  delhi: { sw_lat: 28.4, sw_lng: 76.84, ne_lat: 28.88, ne_lng: 77.35 },
  gurugram: { sw_lat: 28.35, sw_lng: 76.84, ne_lat: 28.55, ne_lng: 77.13 },
  noida: { sw_lat: 28.4, sw_lng: 77.3, ne_lat: 28.65, ne_lng: 77.55 },
  ghaziabad: { sw_lat: 28.6, sw_lng: 77.28, ne_lat: 28.78, ne_lng: 77.55 },
  faridabad: { sw_lat: 28.3, sw_lng: 77.25, ne_lat: 28.5, ne_lng: 77.42 },
  chandigarh: { sw_lat: 30.65, sw_lng: 76.7, ne_lat: 30.82, ne_lng: 76.86 },
  jaipur: { sw_lat: 26.78, sw_lng: 75.7, ne_lat: 27.01, ne_lng: 75.93 },
  lucknow: { sw_lat: 26.7, sw_lng: 80.8, ne_lat: 26.95, ne_lng: 81.1 }
};

/**
 * Each metro system has one operator. We label by `city` slug (the slug of
 * the seed file each line was loaded from), which is unambiguous because
 * one operator manages one system per city.
 */
export const SYSTEM_BY_CITY: Record<string, string> = {
  delhi: "DMRC",
  gurugram: "Rapid Metro Gurgaon",
  noida: "NMRC Aqua",
  lucknow: "UPMRC",
  jaipur: "JMRC"
};
