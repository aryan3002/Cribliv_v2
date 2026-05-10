"use client";

import { useEffect, useState } from "react";
import { fetchApi } from "../../../lib/api";
import { useMapState } from "./useMapState";
import { haversineKm } from "../../../lib/geo";

export interface MetroStation {
  id: number;
  name: string;
  lat: number;
  lng: number;
  sequence: number;
  /** True when this station sits within ~200 m of a station on a different
   *  line / system — i.e. it's an interchange. Computed client-side from
   *  the merged station set so it doesn't require backend coordination. */
  interchange?: boolean;
  /** Other lines you can transfer to from this interchange — populated
   *  alongside `interchange = true`. Used in the tooltip. */
  connections?: Array<{ line_name: string; line_color: string; system: string }>;
}

export interface MetroLine {
  line_name: string;
  line_color: string;
  /** Operator system, e.g. "DMRC", "Rapid Metro Gurgaon", "NMRC Aqua". */
  system: string;
  /** City slug this line was seeded under. */
  city: string;
  stations: MetroStation[];
}

/* ── Interchange detection ─────────────────────────────────────────
 *  An interchange is any station within ~200 m of a station on a
 *  DIFFERENT (city, line_name) pair. We do this client-side (vs in SQL)
 *  because: (a) the merged set is small (~300 stations max), (b) it
 *  doesn't require a backend migration, (c) it stays correct as we add
 *  more cities. O(N²) is fine at this scale (~90k comparisons worst-case,
 *  <5 ms in practice). */
const INTERCHANGE_RADIUS_KM = 0.2;
function annotateInterchanges(lines: MetroLine[]): MetroLine[] {
  // Flatten with parent-line ref so we can look up line metadata.
  const all = lines.flatMap((line) => line.stations.map((station) => ({ line, station })));
  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    for (let j = i + 1; j < all.length; j++) {
      const b = all[j];
      // Same line — not an interchange.
      if (a.line.city === b.line.city && a.line.line_name === b.line.line_name) continue;
      if (haversineKm(a.station, b.station) > INTERCHANGE_RADIUS_KM) continue;
      a.station.interchange = true;
      b.station.interchange = true;
      a.station.connections = a.station.connections ?? [];
      b.station.connections = b.station.connections ?? [];
      a.station.connections.push({
        line_name: b.line.line_name,
        line_color: b.line.line_color,
        system: b.line.system
      });
      b.station.connections.push({
        line_name: a.line.line_name,
        line_color: a.line.line_color,
        system: a.line.system
      });
    }
  }
  return lines;
}

/* Per-city in-memory cache. Replaces the previous single-shot module-scoped
 * cache so switching cities mid-session correctly re-fetches and doesn't
 * return stale Delhi data when viewing Lucknow (etc.). */
const cache = new Map<string, MetroLine[]>();
const inflight = new Map<string, Promise<MetroLine[]>>();

function fetchLinesForCity(city: string): Promise<MetroLine[]> {
  const cached = cache.get(city);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(city);
  if (pending) return pending;
  const p = fetchApi<{ lines: MetroLine[] }>(`/map/metro?city=${encodeURIComponent(city)}`)
    .then((data) => {
      const lines = annotateInterchanges(data?.lines ?? []);
      cache.set(city, lines);
      inflight.delete(city);
      return lines;
    })
    .catch(() => {
      // Cache empty on failure too, so we don't hammer the API while the
      // user toggles. They'll get an empty/unsupported state until reload.
      cache.set(city, []);
      inflight.delete(city);
      return [] as MetroLine[];
    });
  inflight.set(city, p);
  return p;
}

interface UseMetroDataResult {
  lines: MetroLine[];
  loading: boolean;
  /** True iff the current city has at least one metro line in the DB. Drives
   *  the "Metro not yet available" toast and prevents the toolbar button
   *  from getting stuck in an active state for unsupported cities. */
  supported: boolean;
  city: string;
}

export function useMetroData(): UseMetroDataResult {
  const { city } = useMapState();
  const [lines, setLines] = useState<MetroLine[]>(() => cache.get(city) ?? []);
  const [loading, setLoading] = useState<boolean>(() => !cache.has(city));

  useEffect(() => {
    let cancelled = false;
    const cached = cache.get(city);
    if (cached) {
      setLines(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchLinesForCity(city).then((next) => {
      if (cancelled) return;
      setLines(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [city]);

  return {
    lines,
    loading,
    supported: lines.length > 0,
    city
  };
}
