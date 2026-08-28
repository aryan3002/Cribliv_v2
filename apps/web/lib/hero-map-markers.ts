// Picks which live listings become price pills on the homepage hero map.
// Pure so the projection/thinning rules are unit-testable without React.
import { projectToBounds, type GeoBounds } from "./geo";
import type { HeroPin } from "./hero-query";

export interface HeroMapMarker {
  id: string;
  xPct: number;
  yPct: number;
  rentLabel: string;
}

const EDGE_PAD_PCT = 4;

export function selectHeroMarkers(
  pins: HeroPin[],
  bounds: GeoBounds,
  opts: { maxMarkers?: number; minGapPct?: number } = {}
): HeroMapMarker[] {
  const maxMarkers = opts.maxMarkers ?? 8;
  const minGapPct = opts.minGapPct ?? 9;

  const candidates = pins
    .filter(
      (pin) =>
        Number.isFinite(pin.lat) &&
        Number.isFinite(pin.lng) &&
        (pin.monthly_rent ?? 0) > 0 &&
        pin.lat >= bounds.sw.lat &&
        pin.lat <= bounds.ne.lat &&
        pin.lng >= bounds.sw.lng &&
        pin.lng <= bounds.ne.lng
    )
    .map((pin) => ({ pin, pos: projectToBounds(pin.lat, pin.lng, bounds) }))
    .filter(
      ({ pos }) =>
        pos.xPct >= EDGE_PAD_PCT &&
        pos.xPct <= 100 - EDGE_PAD_PCT &&
        pos.yPct >= EDGE_PAD_PCT &&
        pos.yPct <= 100 - EDGE_PAD_PCT
    )
    // Verified pins first so the proximity thinning below drops unverified
    // ones; ties broken by rent so the label spread skews affordable.
    .sort((a, b) => {
      const av = a.pin.verification_status === "verified" ? 0 : 1;
      const bv = b.pin.verification_status === "verified" ? 0 : 1;
      return av - bv || a.pin.monthly_rent - b.pin.monthly_rent;
    });

  const kept: HeroMapMarker[] = [];
  for (const { pin, pos } of candidates) {
    if (kept.length >= maxMarkers) break;
    const tooClose = kept.some((m) => Math.hypot(m.xPct - pos.xPct, m.yPct - pos.yPct) < minGapPct);
    if (tooClose) continue;
    kept.push({
      id: pin.id,
      xPct: pos.xPct,
      yPct: pos.yPct,
      rentLabel: `₹${pin.monthly_rent.toLocaleString("en-IN")}`
    });
  }
  return kept;
}
