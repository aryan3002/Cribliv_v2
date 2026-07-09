#!/usr/bin/env node
// Generates the homepage hero backdrop for a city via the Google Static
// Maps API and prints the EXACT geographic bounds of the produced image.
// Image and bounds are only valid as a pair — paste the printed bounds
// into HOME_CITIES[<slug>].bounds in apps/web/lib/home-city-config.ts.
//
// Usage:
//   GOOGLE_MAPS_KEY=... node scripts/generate-home-map.mjs lucknow 26.70 80.80 26.95 81.10
// Args: <slug> <swLat> <swLng> <neLat> <neLng>  (use CITY_BBOXES values)

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const [slug, swLat, swLng, neLat, neLng] = process.argv.slice(2);
const KEY = process.env.GOOGLE_MAPS_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
if (!slug || !swLat || !KEY) {
  console.error(
    "Usage: GOOGLE_MAPS_KEY=... node scripts/generate-home-map.mjs <slug> <swLat> <swLng> <neLat> <neLng>"
  );
  process.exit(1);
}
const bbox = {
  sw: { lat: Number(swLat), lng: Number(swLng) },
  ne: { lat: Number(neLat), lng: Number(neLng) }
};

// --- Web Mercator (mirrors apps/web/lib/geo.ts; script can't import TS) ---
const worldSize = (z) => 256 * 2 ** z;
const lngToX = (lng, z) => ((lng + 180) / 360) * worldSize(z);
const latToY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * worldSize(z);
};
const yToLat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / worldSize(z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};
const xToLng = (x, z) => (x / worldSize(z)) * 360 - 180;
const boundsAt = (center, z, w, h) => {
  const cx = lngToX(center.lng, z);
  const cy = latToY(center.lat, z);
  return {
    sw: { lat: yToLat(cy + h / 2, z), lng: xToLng(cx - w / 2, z) },
    ne: { lat: yToLat(cy - h / 2, z), lng: xToLng(cx + w / 2, z) }
  };
};
const fits = (img, b) =>
  img.sw.lat <= b.sw.lat &&
  img.ne.lat >= b.ne.lat &&
  img.sw.lng <= b.sw.lng &&
  img.ne.lng >= b.ne.lng;

// Static Maps standard-plan limit: 640x640 logical px, scale=2 → 1280x1280 real px.
const SHAPES = [
  { suffix: "", w: 640, h: 400 }, // landscape → 1280x800
  { suffix: "-mobile", w: 400, h: 640 } // portrait → 800x1280
];
const center = {
  lat: (bbox.sw.lat + bbox.ne.lat) / 2,
  lng: (bbox.sw.lng + bbox.ne.lng) / 2
};

// Dusk styling: dark ground, faint roads, subtle water — flat, low contrast.
const STYLE = [
  "feature:all|element:labels|visibility:off",
  "feature:landscape|element:geometry|color:0x0f1728",
  "feature:road|element:geometry|color:0x1e293f",
  "feature:road.arterial|element:geometry|color:0x223052",
  "feature:water|element:geometry|color:0x16314a",
  "feature:poi|element:geometry|color:0x111b30",
  "feature:transit|visibility:off",
  "feature:administrative|visibility:off"
]
  .map((s) => `style=${encodeURIComponent(s)}`)
  .join("&");

const outDir = path.join("apps", "web", "public", "images", "home");
await mkdir(outDir, { recursive: true });

for (const shape of SHAPES) {
  // Real pixel size is 2x the logical request (scale=2).
  let zoom = 15;
  while (zoom > 1 && !fits(boundsAt(center, zoom, shape.w * 2, shape.h * 2), bbox)) zoom--;
  const bounds = boundsAt(center, zoom, shape.w * 2, shape.h * 2);
  const url =
    `https://maps.googleapis.com/maps/api/staticmap?center=${center.lat},${center.lng}` +
    `&zoom=${zoom}&size=${shape.w}x${shape.h}&scale=2&format=png&${STYLE}&key=${KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Static Maps request failed (${res.status}) for ${slug}${shape.suffix}.`);
    console.error(
      "Enable the 'Maps Static API' for this key, or ship the CSS fallback (the hero tolerates a missing image)."
    );
    process.exit(2);
  }
  const file = path.join(outDir, `${slug}-dusk${shape.suffix}.png`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  console.log(`wrote ${file} (zoom ${zoom})`);
  if (!shape.suffix) {
    console.log(
      "\nPaste into HOME_CITIES." + slug + ".bounds (apps/web/lib/home-city-config.ts):\n"
    );
    console.log(
      JSON.stringify(
        {
          sw: { lat: +bounds.sw.lat.toFixed(5), lng: +bounds.sw.lng.toFixed(5) },
          ne: { lat: +bounds.ne.lat.toFixed(5), lng: +bounds.ne.lng.toFixed(5) }
        },
        null,
        2
      )
    );
  }
}
