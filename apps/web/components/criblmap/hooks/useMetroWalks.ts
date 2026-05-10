"use client";

import { useEffect, useState } from "react";
import { fetchApi } from "../../../lib/api";

export interface ListingWalk {
  station_id: number;
  distance_m: number;
  duration_s: number;
}

/* Per-listing walks cache. The first call for a listing pays for one
 * Distance Matrix round-trip on the server (cached forever DB-side);
 * subsequent client renders read from this in-memory map for free. */
const cache = new Map<string, Map<number, ListingWalk>>();
const inflight = new Map<string, Promise<Map<number, ListingWalk>>>();

function fetchWalks(listingId: string): Promise<Map<number, ListingWalk>> {
  const cached = cache.get(listingId);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(listingId);
  if (pending) return pending;
  const p = fetchApi<{ walks: ListingWalk[] }>(
    `/map/metro/walks?listing_id=${encodeURIComponent(listingId)}`
  )
    .then((data) => {
      const map = new Map<number, ListingWalk>();
      for (const w of data?.walks ?? []) {
        map.set(w.station_id, w);
      }
      cache.set(listingId, map);
      inflight.delete(listingId);
      return map;
    })
    .catch(() => {
      const empty = new Map<number, ListingWalk>();
      cache.set(listingId, empty);
      inflight.delete(listingId);
      return empty;
    });
  inflight.set(listingId, p);
  return p;
}

interface UseMetroWalksResult {
  walks: Map<number, ListingWalk>;
  loading: boolean;
}

/**
 * Returns the walking distance + duration from `listingId` to every metro
 * station in its city. Fetches lazily; falls back to an empty map (callers
 * should fall back to Haversine when a station is missing from the result).
 */
export function useMetroWalks(listingId: string | null): UseMetroWalksResult {
  const [walks, setWalks] = useState<Map<number, ListingWalk>>(
    () => (listingId && cache.get(listingId)) || new Map()
  );
  const [loading, setLoading] = useState<boolean>(
    () => Boolean(listingId) && !cache.has(listingId ?? "")
  );

  useEffect(() => {
    if (!listingId) {
      setWalks(new Map());
      setLoading(false);
      return;
    }
    const cached = cache.get(listingId);
    if (cached) {
      setWalks(cached);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchWalks(listingId).then((next) => {
      if (cancelled) return;
      setWalks(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [listingId]);

  return { walks, loading };
}
