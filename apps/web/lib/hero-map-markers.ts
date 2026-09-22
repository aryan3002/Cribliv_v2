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
// The pill is drawn ABOVE its anchor (translate(-50%, -100%)), so the top
// edge needs a deeper keep-out than the other three or a pin near the north
// boundary renders with its rupee digits guillotined by the hero's clip.
const TOP_PAD_PCT = 12;

type Candidate = { pin: HeroPin; pos: { xPct: number; yPct: number } };

// Evenly spaced sample across a rent-ascending group (first, last, and even
// strides between), remainder appended — so the pills advertise the whole
// price range of the group instead of just its cheapest entries.
function rentSpreadOrder(group: Candidate[], slots: number): Candidate[] {
  const take = Math.min(group.length, slots);
  const order: Candidate[] = [];
  const picked = new Set<number>();
  for (let i = 0; i < take; i += 1) {
    const idx = take === 1 ? 0 : Math.round((i * (group.length - 1)) / (take - 1));
    if (!picked.has(idx)) {
      picked.add(idx);
      order.push(group[idx]);
    }
  }
  group.forEach((candidate, idx) => {
    if (!picked.has(idx)) order.push(candidate);
  });
  return order;
}

export function selectHeroMarkers(
  pins: HeroPin[],
  bounds: GeoBounds,
  opts: { maxMarkers?: number; minGapPct?: number; minXPct?: number } = {}
): HeroMapMarker[] {
  const maxMarkers = opts.maxMarkers ?? 8;
  const minGapPct = opts.minGapPct ?? 9;
  // Keep-out for a content column overlaying the left of the map: markers
  // whose pill would sit under the headline/search copy are skipped.
  const minXPct = Math.max(opts.minXPct ?? 0, EDGE_PAD_PCT);

  const candidates: Candidate[] = pins
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
        pos.xPct >= minXPct &&
        pos.xPct <= 100 - EDGE_PAD_PCT &&
        pos.yPct >= TOP_PAD_PCT &&
        pos.yPct <= 100 - EDGE_PAD_PCT
    )
    .sort((a, b) => a.pin.monthly_rent - b.pin.monthly_rent);

  // Verified pins get every slot before an unverified pin is considered;
  // within each group, visit in rent-spread order so the labels sample the
  // group's whole price range.
  const verified = candidates.filter((c) => c.pin.verification_status === "verified");
  const unverified = candidates.filter((c) => c.pin.verification_status !== "verified");
  const visitOrder = [
    ...rentSpreadOrder(verified, maxMarkers),
    ...rentSpreadOrder(unverified, maxMarkers)
  ];

  const kept: HeroMapMarker[] = [];
  for (const { pin, pos } of visitOrder) {
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
