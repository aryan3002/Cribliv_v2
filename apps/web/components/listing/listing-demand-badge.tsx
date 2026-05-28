"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Flame, ArrowRight } from "lucide-react";
import { fetchApi } from "../../lib/api";

interface DemandData {
  count: number;
  avg_budget: number | null;
}

interface ListingDemandBadgeProps {
  listingId: string;
  locale: string;
  city: string;
}

/**
 * Public-facing "demand pressure" badge on the listing detail page. Shows
 * the count of active seeker pins that match this listing's BHK + rent
 * within each seeker's own search radius. Silent zero-state — never
 * renders if nobody matches, so we don't pad listings with "0 seekers".
 *
 * Links into the map with this listing centred so the owner (or any
 * onlooker) can see the actual demand cluster.
 */
export function ListingDemandBadge({ listingId, locale, city }: ListingDemandBadgeProps) {
  const [data, setData] = useState<DemandData | null>(null);

  useEffect(() => {
    if (!listingId) return;
    let cancelled = false;
    fetchApi<DemandData>(`/map/seekers/near-listing?listing_id=${encodeURIComponent(listingId)}`)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        /* non-blocking — silently ignore */
      });
    return () => {
      cancelled = true;
    };
  }, [listingId]);

  if (!data || data.count === 0) return null;

  const mapHref = `/${locale}/map?city=${encodeURIComponent(city)}&listing=${encodeURIComponent(listingId)}&showDemand=true`;

  return (
    <Link
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      href={mapHref as any}
      className="ld-demand-badge"
      aria-label={`${data.count} seekers actively looking for a place like this`}
    >
      <Flame size={14} className="ld-demand-badge__icon" />
      <span className="ld-demand-badge__text">
        <strong>{data.count}</strong> active {data.count === 1 ? "seeker matches" : "seekers match"}{" "}
        this listing nearby
      </span>
      <ArrowRight size={12} className="ld-demand-badge__arrow" />
    </Link>
  );
}
