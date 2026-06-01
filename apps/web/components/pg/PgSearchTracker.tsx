"use client";
import { useEffect, useRef } from "react";
import { trackPgSearch } from "../../lib/pg-track";

export function PgSearchTracker({
  city,
  query,
  filters,
  resultCount,
  shownListingIds
}: {
  city?: string;
  query?: string;
  filters: Record<string, string>;
  resultCount: number;
  shownListingIds: string[];
}) {
  // Fire once per distinct query signature (re-fires when the user changes the
  // search), not on every React re-render.
  const sig = JSON.stringify({ city, query, filters });
  const lastSig = useRef<string | null>(null);
  useEffect(() => {
    if (lastSig.current === sig) return;
    lastSig.current = sig;
    trackPgSearch({
      city,
      query,
      filters,
      result_count: resultCount,
      shown_listing_ids: shownListingIds
    });
  }, [sig, city, query, filters, resultCount, shownListingIds]);
  return null;
}
