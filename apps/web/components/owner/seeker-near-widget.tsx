"use client";

import { useEffect, useState } from "react";
import { Users, TrendingUp, MapPin } from "lucide-react";
import { fetchApi } from "../../lib/api";

interface SeekerData {
  count: number;
  avg_budget: number | null;
}

interface SeekerNearWidgetProps {
  listingId: string;
  accessToken: string | null;
}

/**
 * Small inline widget for the owner dashboard listing card.
 * Shows how many active seekers are searching near the listing.
 */
export function SeekerNearWidget({ listingId, accessToken }: SeekerNearWidgetProps) {
  const [data, setData] = useState<SeekerData | null>(null);

  useEffect(() => {
    if (!accessToken || !listingId) return;

    let cancelled = false;
    fetchApi<SeekerData>(`/map/seekers/near-listing?listing_id=${listingId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        /* non-critical — silently ignore */
      });

    return () => {
      cancelled = true;
    };
  }, [listingId, accessToken]);

  if (!data || data.count === 0) return null;

  return (
    <div className="dlx-seeker-near">
      <Users size={13} className="dlx-seeker-near__icon" />
      <span className="dlx-seeker-near__count">
        {data.count} seeker{data.count !== 1 ? "s" : ""} nearby
      </span>
      {data.avg_budget && (
        <span className="dlx-seeker-near__budget">
          · Avg budget ₹{data.avg_budget.toLocaleString("en-IN")}
        </span>
      )}
    </div>
  );
}
