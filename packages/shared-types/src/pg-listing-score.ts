import type { PgListingPayload } from "./pg-operator";

export interface PgScoreSignals {
  verification_status: "unverified" | "pending" | "verified";
  created_at?: string | null;
  has_exact_geo: boolean;
  photo_count: number;
}

export interface PgScoreFactor {
  key:
    | "completeness"
    | "photos"
    | "geo_precision"
    | "pricing"
    | "amenities"
    | "verification"
    | "freshness";
  score: number;
  weight: number;
  weighted: number;
}

export interface PgScoreRecommendation {
  id: string;
  label: string;
  points: number;
  step: 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

// Canonical 7-step order: 1 Basics · 2 Location · 3 Rooms&Pricing · 4 Payment · 5 Rules · 6 Amenities&Food · 7 Photos
export interface PgScoreResult {
  composite: number;
  factors: PgScoreFactor[];
  recommendations: PgScoreRecommendation[];
}

const W = {
  completeness: 0.28,
  photos: 0.18,
  pricing: 0.16,
  geo_precision: 0.12,
  amenities: 0.1,
  verification: 0.1,
  freshness: 0.06
} as const;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function computePgListingScore(
  payload: PgListingPayload,
  signals: PgScoreSignals
): PgScoreResult {
  const d = payload.pg_details ?? ({} as PgListingPayload["pg_details"]);
  const rooms = payload.room_types ?? [];

  // completeness: fraction of key fields present
  const completenessChecks = [
    !!payload.property?.display_name && payload.property.display_name.length >= 2,
    !!payload.property?.city_slug,
    !!d.gender_policy,
    !!d.tenant_type,
    (d.security_deposit_paise ?? 0) > 0,
    rooms.length >= 1,
    !!d.house_rules && Object.keys(d.house_rules).length > 0,
    !!d.meals
  ];
  const completeness = clamp01(
    completenessChecks.filter(Boolean).length / completenessChecks.length
  );

  // photos: linear 0→0, 6→1 (mirrors worker listing_scores formula; recommendation removed at ≥6)
  const pc = signals.photo_count;
  const photos = clamp01(pc / 6);

  // pricing: every room type has a monthly rent set (room-level deposit is
  // optional — property-level deposit is covered by `completeness`)
  const pricing =
    rooms.length === 0
      ? 0
      : clamp01(rooms.filter((r) => (r.monthly_rent_paise ?? 0) > 0).length / rooms.length);

  const geo_precision = signals.has_exact_geo ? 1 : 0.3;

  // PgAmenities = { core?: string[]; room?: string[]; services?: string[]; extras?: string[] }
  // Count total amenities across all categories, normalize at 6
  const amenityCount = d.amenities
    ? (d.amenities.core?.length ?? 0) +
      (d.amenities.room?.length ?? 0) +
      (d.amenities.services?.length ?? 0) +
      (d.amenities.extras?.length ?? 0)
    : 0;
  const amenities = clamp01(amenityCount / 6);

  const verification =
    signals.verification_status === "verified"
      ? 1
      : signals.verification_status === "pending"
        ? 0.5
        : 0.2;

  let freshness = 1;
  if (signals.created_at) {
    const ageDays = (Date.now() - new Date(signals.created_at).getTime()) / 86_400_000;
    freshness = clamp01(1 - ageDays / 30);
  }

  const raw = { completeness, photos, pricing, geo_precision, amenities, verification, freshness };
  const factors: PgScoreFactor[] = (Object.keys(W) as Array<keyof typeof W>).map((k) => ({
    key: k,
    score: raw[k],
    weight: W[k],
    weighted: raw[k] * W[k]
  }));
  const composite = Math.round(factors.reduce((s, f) => s + f.weighted, 0) * 100);

  const delta = (k: keyof typeof W, target: number, cur: number) =>
    Math.round((target - cur) * W[k] * 100);

  const recs: PgScoreRecommendation[] = [];
  if (photos < 1)
    recs.push({
      id: "add_photos",
      label:
        pc < 4
          ? `Add ${4 - pc} more photos (4 required)`
          : "Add more photos for a stronger listing",
      points: delta("photos", 1, photos),
      step: 7
    });
  if (!signals.has_exact_geo)
    recs.push({
      id: "pin_location",
      label: "Pin your exact location on the map",
      points: delta("geo_precision", 1, geo_precision),
      step: 2
    });
  if (pricing < 1)
    recs.push({
      id: "complete_pricing",
      label: "Set monthly rent for every room type",
      points: delta("pricing", 1, pricing),
      step: 3
    });
  if (completeness < 1)
    recs.push({
      id: "fill_details",
      label: "Complete gender, tenant type & house rules",
      points: delta("completeness", 1, completeness),
      step: 5
    });
  if (amenities < 1)
    recs.push({
      id: "add_amenities",
      label: "Add the amenities you offer",
      points: delta("amenities", 1, amenities),
      step: 6
    });
  if (verification < 1)
    recs.push({
      id: "get_verified",
      label: "Verify your PG to rank higher",
      points: delta("verification", 1, verification),
      step: 1
    });

  recs.sort((a, b) => b.points - a.points);

  return { composite, factors, recommendations: recs.filter((r) => r.points > 0) };
}
