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
