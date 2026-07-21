import type { MapPin } from "../hooks/useMapState";

/**
 * Pure render helpers for the CriblMap listing-pin layer.
 *
 * Split out from ListingPinLayer so the clustering + reconciliation math can be
 * unit-tested directly — the Google Maps advanced markers themselves don't
 * render in the local test/preview environment, so this is the layer's only
 * reliable local verification path.
 */

export interface ClusterGroup {
  /** Stable id derived from the grid cell, e.g. `cluster:1343_4047`. */
  id: string;
  pins: MapPin[];
  lat: number;
  lng: number;
}

export type RenderItem = MapPin | ClusterGroup;

export function isCluster(item: RenderItem): item is ClusterGroup {
  return "pins" in item;
}

function gridSizeForZoom(zoom: number): number {
  return zoom <= 10 ? 0.05 : 0.02;
}

interface Cell {
  key: string;
  pins: MapPin[];
  sumLat: number;
  sumLng: number;
}

/**
 * Bucket pins into a grid and collapse multi-pin cells into clusters. At zoom
 * >= 14 every pin renders individually. Each cluster carries a stable id (its
 * cell key) and sits at the true centroid of its members, so re-clustering the
 * same pins produces the same id + position regardless of input order.
 */
export function clusterPins(pins: MapPin[], zoom: number): RenderItem[] {
  if (zoom >= 14) return [...pins];

  const gridSize = gridSizeForZoom(zoom);
  const cells = new Map<string, Cell>();

  for (const pin of pins) {
    const key = `${Math.round(pin.lat / gridSize)}_${Math.round(pin.lng / gridSize)}`;
    const existing = cells.get(key);
    if (existing) {
      existing.pins.push(pin);
      existing.sumLat += pin.lat;
      existing.sumLng += pin.lng;
    } else {
      cells.set(key, { key, pins: [pin], sumLat: pin.lat, sumLng: pin.lng });
    }
  }

  const result: RenderItem[] = [];
  for (const cell of cells.values()) {
    if (cell.pins.length === 1) {
      result.push(cell.pins[0]);
    } else {
      const n = cell.pins.length;
      result.push({
        id: `cluster:${cell.key}`,
        pins: cell.pins,
        lat: cell.sumLat / n,
        lng: cell.sumLng / n
      });
    }
  }
  return result;
}

/** Stable identity for reconciliation — pin uuid or the `cluster:` cell key. */
export function renderKey(item: RenderItem): string {
  return item.id;
}

/**
 * A string of everything that affects a rendered item's DOM. Two items with the
 * same signature produce identical markup, so reconciliation can skip them.
 * Selection and opacity are deliberately excluded — they're applied by separate
 * in-place passes and must not force a re-render.
 */
export function pinSignature(item: RenderItem): string {
  if (isCluster(item)) {
    const verified = item.pins.filter((p) => p.verification_status === "verified").length;
    return `c:${item.pins.length}:${verified}:${item.lat.toFixed(4)}:${item.lng.toFixed(4)}`;
  }
  return [
    "p",
    item.verification_status,
    item.listing_type,
    item.bhk ?? "",
    item.monthly_rent,
    item.belowMarket ? 1 : 0
  ].join(":");
}

/**
 * Partition the next render set against the currently-mounted keys:
 * `toAdd` need new markers, `toRemove` keys should be detached, `toKeep` are
 * still present (the caller compares signatures to decide in-place updates).
 */
export function diffRenderItems(
  prevKeys: Iterable<string>,
  nextItems: RenderItem[]
): { toAdd: RenderItem[]; toRemove: string[]; toKeep: RenderItem[] } {
  const prev = new Set(prevKeys);
  const nextKeys = new Set<string>();
  const toAdd: RenderItem[] = [];
  const toKeep: RenderItem[] = [];

  for (const item of nextItems) {
    const key = renderKey(item);
    nextKeys.add(key);
    if (prev.has(key)) toKeep.push(item);
    else toAdd.push(item);
  }

  const toRemove: string[] = [];
  for (const key of prev) {
    if (!nextKeys.has(key)) toRemove.push(key);
  }

  return { toAdd, toRemove, toKeep };
}
