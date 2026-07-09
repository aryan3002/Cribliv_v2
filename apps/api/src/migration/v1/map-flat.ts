import { normalizeCitySlug } from "./cities";
import type { V1Property } from "./types";

export interface FlatInput {
  v1Id: string;
  titleEn: string;
  descriptionEn: string | null;
  monthlyRent: number;
  securityDeposit: number | null;
  bhk: number | null;
  bathrooms: number | null;
  areaSqft: number | null;
  furnishing: string | null;
  preferredTenant: string | null;
  availableFrom: string | null;
  whatsappAvailable: boolean;
  amenities: string[];
  citySlug: string | null;
  addressLine1: string;
  landmark: string | null;
  pincode: string | null;
  lat: number | null;
  lng: number | null;
  publicIds: string[];
  warnings: string[];
}

export function toInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v).replace(/[^\d.-]/g, ""), 10);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function mapFurnishing(
  v1?: string
): "unfurnished" | "semi_furnished" | "fully_furnished" | null {
  const k = (v1 ?? "").trim().toLowerCase();
  if (!k) return null;
  if (k.includes("unfurnish") || k === "none" || k === "no") return "unfurnished";
  if (k.includes("semi")) return "semi_furnished";
  if (k.includes("fully") || k === "furnished") return "fully_furnished";
  return null;
}

export function mapTenantPref(
  v1?: string
): "any" | "family" | "bachelor" | "female" | "male" | null {
  const k = (v1 ?? "").trim().toLowerCase();
  if (!k) return null;
  if (k.startsWith("famil")) return "family";
  if (k.startsWith("bachelor")) return "bachelor";
  if (k === "female" || k === "girls" || k === "women") return "female";
  if (k === "male" || k === "boys" || k === "men") return "male";
  if (k.startsWith("any") || k === "all") return "any";
  return "any";
}

/**
 * v1 property amenity name (lowercased) → one of the 17 canonical flat display
 * names the web ListingAmenities component matches on. Derived from the real v1
 * distinct set (Air Conditioner, Gas Pipeline, Gated Security, Gym, Lift, Park,
 * Parking, Power Backup, Refrigerator, Television, Washing Machine, Wi-Fi) plus
 * common synonyms. "Park" (nearby park/garden) has no v2 flat amenity → unmapped.
 */
export const FLAT_AMENITY_ALIAS: Record<string, string> = {
  "wi-fi": "WiFi",
  wifi: "WiFi",
  internet: "WiFi",
  "air conditioner": "AC",
  ac: "AC",
  "air conditioning": "AC",
  geyser: "Geyser",
  "water geyser": "Geyser",
  "hot water": "Geyser",
  "washing machine": "Washing Machine",
  refrigerator: "Fridge",
  fridge: "Fridge",
  television: "TV",
  tv: "TV",
  parking: "Parking",
  "car parking": "Parking",
  "bike parking": "Parking",
  "power backup": "Power Backup",
  inverter: "Power Backup",
  generator: "Power Backup",
  "gas pipeline": "Gas Pipeline",
  "piped gas": "Gas Pipeline",
  lift: "Lift",
  elevator: "Lift",
  "gated security": "Security",
  security: "Security",
  "security guard": "Security",
  guard: "Security",
  cctv: "CCTV",
  gym: "Gym",
  gymnasium: "Gym",
  "swimming pool": "Swimming Pool",
  pool: "Swimming Pool",
  balcony: "Balcony",
  kitchen: "Kitchen",
  "modular kitchen": "Kitchen",
  "water purifier": "Water Purifier",
  ro: "Water Purifier"
};

/** Map v1 amenities (objects or strings) → canonical flat display names; collects unmapped. */
export function mapFlatAmenities(v1: unknown): { amenities: string[]; unmapped: string[] } {
  if (!Array.isArray(v1)) return { amenities: [], unmapped: [] };
  const out = new Set<string>();
  const unmapped: string[] = [];
  for (const a of v1) {
    const raw = typeof a === "string" ? a : (a as { amenityName?: string })?.amenityName;
    const name = (raw ?? "").toString().trim();
    if (!name) continue;
    const display = FLAT_AMENITY_ALIAS[name.toLowerCase()];
    if (display) out.add(display);
    else unmapped.push(name);
  }
  return { amenities: [...out], unmapped };
}

/**
 * Title from stored `nameListing`, else composed from address parts (v1's own
 * fallback). De-dups repeated tokens ("Lucknow, Lucknow" → "Lucknow") and drops
 * empty slots ("Near,"). Used for PGs (all 19 have empty nameListing) and any
 * blank flat. `prefix` e.g. "PG in".
 */
export function composeTitleFromAddress(
  doc: { nameListing?: string; society?: string; landmark?: string; city?: string },
  prefix = ""
): string {
  const stored = (doc.nameListing ?? "").toString().trim();
  if (stored) return stored.slice(0, 300);
  const raw = [doc.society, doc.landmark, doc.city]
    .map((s) => (s ?? "").toString())
    .join(", ")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const p of raw) {
    const k = p.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      clean.push(p);
    }
  }
  const body = clean.join(", ") || "Listing";
  return `${prefix ? prefix + " " : ""}${body}`.slice(0, 300);
}

function pincode6(v: unknown): string | null {
  const digits = String(v ?? "").replace(/\D/g, "");
  return digits.length >= 6 ? digits.slice(0, 6) : null;
}

function isoDate(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(v as any);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function mapFlat(doc: V1Property): FlatInput {
  const warnings: string[] = [];
  const rent = toInt(doc.expected_rent);
  if (!rent || rent <= 0) warnings.push("no rent");

  const citySlug = normalizeCitySlug(doc.city ?? "");
  if (!citySlug) warnings.push(`unknown city: ${doc.city ?? "(none)"}`);

  const coords = doc.location?.coordinates;
  const lng = Array.isArray(coords) && typeof coords[0] === "number" ? coords[0] : null;
  const lat = Array.isArray(coords) && typeof coords[1] === "number" ? coords[1] : null;
  if (lat == null || lng == null) warnings.push("no geo");

  const addressParts = [doc.houseNum, doc.society, doc.landmark, doc.city]
    .map((s) => (s ?? "").toString().trim())
    .filter(Boolean);
  const addressLine1 = addressParts.join(", ") || doc.nameListing?.trim() || "Address unavailable";

  const flatAmenities = mapFlatAmenities(doc.amenities);
  if (flatAmenities.unmapped.length)
    warnings.push(`unmapped amenities: ${flatAmenities.unmapped.join(", ")}`);

  return {
    v1Id: String(doc._id),
    titleEn: composeTitleFromAddress(doc),
    descriptionEn: doc.description ? String(doc.description) : null,
    monthlyRent: rent && rent > 0 ? rent : 0,
    securityDeposit: toInt(doc.expected_deposit),
    bhk: toInt(doc.bedrooms),
    bathrooms: toInt(doc.bathrooms),
    areaSqft: toInt(doc.area),
    furnishing: mapFurnishing(doc.furnishing),
    preferredTenant: mapTenantPref(doc.pref_tenant),
    availableFrom: isoDate(doc.avail_from),
    whatsappAvailable: false,
    amenities: flatAmenities.amenities,
    citySlug,
    addressLine1: addressLine1.slice(0, 500),
    landmark: doc.landmark ? String(doc.landmark) : null,
    pincode: pincode6(doc.pincode),
    lat,
    lng,
    publicIds: Array.isArray(doc.cloudinary_public_ids)
      ? doc.cloudinary_public_ids.map((p) => String(p)).filter(Boolean)
      : [],
    warnings
  };
}
