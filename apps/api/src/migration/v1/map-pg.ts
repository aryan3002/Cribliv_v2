import { toInt, mapFurnishing, composeTitleFromAddress } from "./map-flat";
import { normalizeCitySlug } from "./cities";

type Bucket = "core" | "room" | "services" | "extras";

/** v1 free-text amenity name (lowercased) → [v2 bucket, v2 code]. Extend from B1 discovery. */
export const AMENITY_ALIAS: Record<string, [Bucket, string]> = {
  wifi: ["core", "wifi"],
  "wi-fi": ["core", "wifi"],
  internet: ["core", "wifi"],
  "hot water": ["core", "hot_water"],
  geyser: ["core", "hot_water"],
  "water geyser": ["core", "hot_water"],
  "power backup": ["core", "power_backup"],
  inverter: ["core", "power_backup"],
  generator: ["core", "power_backup"],
  cctv: ["core", "cctv"],
  "security camera": ["core", "cctv"],
  security: ["core", "security_guard"],
  guard: ["core", "security_guard"],
  "security guard": ["core", "security_guard"],
  ac: ["room", "ac"],
  "air conditioner": ["room", "ac"],
  "air conditioning": ["room", "ac"],
  tv: ["room", "tv"],
  television: ["room", "tv"],
  "study table": ["room", "study_table"],
  desk: ["room", "study_table"],
  wardrobe: ["room", "wardrobe"],
  almirah: ["room", "wardrobe"],
  cupboard: ["room", "wardrobe"],
  locker: ["room", "safety_locker"],
  "safety locker": ["room", "safety_locker"],
  mattress: ["room", "mattress"],
  bed: ["room", "mattress"],
  housekeeping: ["services", "housekeeping"],
  cleaning: ["services", "housekeeping"],
  laundry: ["services", "laundry"],
  "washing machine": ["services", "laundry"],
  biometric: ["services", "biometric_access"],
  "biometric access": ["services", "biometric_access"],
  parking: ["extras", "parking_2w"],
  "bike parking": ["extras", "parking_2w"],
  "2 wheeler parking": ["extras", "parking_2w"],
  "car parking": ["extras", "parking_4w"],
  "4 wheeler parking": ["extras", "parking_4w"],
  fridge: ["extras", "fridge"],
  refrigerator: ["extras", "fridge"],
  microwave: ["extras", "microwave"],
  oven: ["extras", "microwave"],
  gym: ["extras", "gym"],
  gymnasium: ["extras", "gym"],
  games: ["extras", "indoor_games"],
  "indoor games": ["extras", "indoor_games"]
};

function amenityNames(v1: any): string[] {
  if (!Array.isArray(v1)) return [];
  return v1
    .map((a) => (typeof a === "string" ? a : a?.amenityName))
    .filter(Boolean)
    .map(String);
}

export function mapPgAmenities(v1: any): {
  core: string[];
  room: string[];
  services: string[];
  extras: string[];
  unmapped: string[];
} {
  const out = {
    core: new Set<string>(),
    room: new Set<string>(),
    services: new Set<string>(),
    extras: new Set<string>()
  };
  const unmapped: string[] = [];
  for (const name of amenityNames(v1)) {
    const hit = AMENITY_ALIAS[name.trim().toLowerCase()];
    if (hit) out[hit[0]].add(hit[1]);
    else unmapped.push(name);
  }
  return {
    core: [...out.core],
    room: [...out.room],
    services: [...out.services],
    extras: [...out.extras],
    unmapped
  };
}

export type Sharing = "single" | "double" | "triple" | "quad" | "dorm";
export type BathroomKind =
  | "attached_western"
  | "attached_indian"
  | "shared_western"
  | "shared_indian";

/** v1 bed.type IS the sharing kind (count = quantity). 'four'/'Four' → quad. */
export const SHARING_ALIAS: Record<string, Sharing> = {
  single: "single",
  double: "double",
  triple: "triple",
  four: "quad",
  quad: "quad",
  dorm: "dorm"
};
export function sharingFromBedType(type: string): Sharing {
  return SHARING_ALIAS[(type ?? "").trim().toLowerCase()] ?? "single";
}

/** v1 bathroom label → v2 kind. v1 only has shared/private; no western/indian split → default western. */
export const BATHROOM_ALIAS: Record<string, BathroomKind> = {
  private: "attached_western",
  attached: "attached_western",
  western: "attached_western",
  "attached indian": "attached_indian",
  indian: "attached_indian",
  shared: "shared_western",
  common: "shared_western",
  "shared indian": "shared_indian"
};

export interface RoomType {
  sharing: Sharing;
  ac: boolean;
  bathroomKind: BathroomKind;
  furnishing: "unfurnished" | "semi_furnished" | "fully_furnished";
  roomSizeSqft: number | null;
  monthlyRentPaise: number;
  vacancyCount: number;
  availableFrom: string | null;
}

/**
 * Map v1 rooms[] → pg_room_types rows. v1 room.beds is [{type: sharing-kind,
 * count: quantity}], one entry per sharing option. Rows are AGGREGATED by the
 * DB's UNIQUE key (sharing, ac, bathroom_kind, furnishing) — summing vacancy and
 * taking the min positive rent — so the writer's ON CONFLICT never silently
 * overwrites two colliding rooms. v1 has no per-room AC → ac=false (PG-level
 * "Air Conditioner" amenity lands on pg_details.amenities.room instead).
 */
export function mapRoomTypes(rooms: any[]): RoomType[] {
  if (!Array.isArray(rooms)) return [];
  const byKey = new Map<string, RoomType>();
  for (const r of rooms) {
    const beds = Array.isArray(r.beds) && r.beds.length ? r.beds : [{ type: "single", count: 1 }];
    const bathLabel = (
      Array.isArray(r.bathrooms) && r.bathrooms[0]?.type ? String(r.bathrooms[0].type) : ""
    ).toLowerCase();
    const furnishing = mapFurnishing(r.furnishing) ?? "semi_furnished";
    const bathroomKind = BATHROOM_ALIAS[bathLabel] ?? "attached_western";
    const rent = toInt(r.expected_rent) ?? 0;
    const paise = rent > 0 ? rent * 100 : 0;
    const area = toInt(r.area);
    for (const b of beds) {
      const sharing = sharingFromBedType(String(b?.type ?? "single"));
      const ac = false;
      const vacancy = Math.max(1, toInt(b?.count) ?? 1);
      const key = `${sharing}|${ac}|${bathroomKind}|${furnishing}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.vacancyCount += vacancy;
        if (paise > 0 && (existing.monthlyRentPaise === 0 || paise < existing.monthlyRentPaise))
          existing.monthlyRentPaise = paise;
        if (area && area > 0 && !existing.roomSizeSqft) existing.roomSizeSqft = area;
      } else {
        byKey.set(key, {
          sharing,
          ac,
          bathroomKind,
          furnishing,
          roomSizeSqft: area && area > 0 ? area : null,
          monthlyRentPaise: paise,
          vacancyCount: vacancy,
          availableFrom: null
        });
      }
    }
  }
  return [...byKey.values()];
}

export interface PgInput {
  v1Id: string;
  titleEn: string;
  descriptionEn: string | null;
  displayName: string;
  citySlug: string | null;
  addressLine1: string;
  landmark: string | null;
  pincode: string | null;
  lat: number | null;
  lng: number | null;
  totalBeds: number;
  startingRentPaise: number;
  monthlyRentRupees: number;
  rooms: RoomType[];
  amenities: { core: string[]; room: string[]; services: string[]; extras: string[] };
  unmappedAmenities: string[];
  publicIds: string[];
  warnings: string[];
}

export function mapPg(doc: any): PgInput {
  const warnings: string[] = [];
  const rooms = mapRoomTypes(doc.rooms ?? []);
  if (rooms.length === 0) warnings.push("no rooms");
  const rents = rooms.map((r) => r.monthlyRentPaise).filter((p) => p > 0);
  const startingRentPaise = rents.length ? Math.min(...rents) : 0;
  if (startingRentPaise <= 0) warnings.push("no room rent");
  const totalBeds =
    rooms.reduce((s, r) => s + r.vacancyCount, 0) || (toInt(doc.total_beds) ?? rooms.length);

  const citySlug = normalizeCitySlug(doc.city ?? "");
  if (!citySlug) warnings.push(`unknown city: ${doc.city ?? "(none)"}`);
  const coords = doc.location?.coordinates;
  const lng = Array.isArray(coords) && typeof coords[0] === "number" ? coords[0] : null;
  const lat = Array.isArray(coords) && typeof coords[1] === "number" ? coords[1] : null;
  if (lat == null || lng == null) warnings.push("no geo");

  const am = mapPgAmenities(doc.amenities);
  if (am.unmapped.length) warnings.push(`unmapped amenities: ${am.unmapped.join(", ")}`);

  const addr = [doc.houseNum, doc.society, doc.landmark, doc.city]
    .map((s) => (s ?? "").toString().trim())
    .filter(Boolean)
    .join(", ");
  return {
    v1Id: String(doc._id),
    titleEn: composeTitleFromAddress(doc, "PG in"),
    descriptionEn: doc.description ? String(doc.description) : null,
    displayName: composeTitleFromAddress(doc, "PG in").slice(0, 200),
    citySlug,
    addressLine1: (addr || doc.nameListing?.trim() || "Address unavailable").slice(0, 500),
    landmark: doc.landmark ? String(doc.landmark) : null,
    pincode:
      String(doc.pincode ?? "")
        .replace(/\D/g, "")
        .slice(0, 6) || null,
    lat,
    lng,
    totalBeds,
    startingRentPaise,
    monthlyRentRupees: startingRentPaise > 0 ? Math.round(startingRentPaise / 100) : 0,
    rooms,
    amenities: { core: am.core, room: am.room, services: am.services, extras: am.extras },
    unmappedAmenities: am.unmapped,
    publicIds: Array.isArray(doc.cloudinary_public_ids)
      ? doc.cloudinary_public_ids.map(String).filter(Boolean)
      : [],
    warnings
  };
}
