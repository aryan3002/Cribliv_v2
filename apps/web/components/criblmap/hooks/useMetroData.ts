"use client";

import { useEffect, useState } from "react";
import { fetchApi } from "../../../lib/api";
import { useMapState } from "./useMapState";

export interface MetroStation {
  id: number;
  name: string;
  lat: number;
  lng: number;
  sequence: number;
}

export interface MetroLine {
  line_name: string;
  line_color: string;
  stations: MetroStation[];
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
      const lines = data?.lines ?? [];
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
