"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchAdminPgListing,
  fetchAdminPgListingAnalytics,
  fetchAdminPgListingFull
} from "../../../lib/admin-api";
import type {
  PgAdminListingDetail,
  PgAdminListingAnalytics,
  PgAdminListingFull
} from "@cribliv/shared-types";

export type RangeDays = 7 | 30 | 90;

/**
 * Single data owner for the admin PG listing detail page.
 *  - `detail` (thin header/owner/overrides) + first analytics: eager on mount.
 *  - `analytics`: re-fetched whenever the range changes.
 *  - `full` (pg_details + rooms + photos + property): fetched ONCE, lazily, on
 *    the first content-tab visit (`ensureFull`), then cached for the session and
 *    re-synced only after a mutation (`refetchFull`). `patchFull` applies an
 *    optimistic local merge.
 * All fetches abort on unmount / listing change.
 */
export function useAdminPgListing(accessToken: string, listingId: string, rangeDays: RangeDays) {
  const [detail, setDetail] = useState<PgAdminListingDetail | null>(null);
  const [analytics, setAnalytics] = useState<PgAdminListingAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [full, setFull] = useState<PgAdminListingFull | null>(null);
  const [fullLoading, setFullLoading] = useState(false);
  const [fullError, setFullError] = useState(false);
  const fullRequested = useRef(false);

  // Eager: thin detail + first analytics window.
  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    Promise.all([
      fetchAdminPgListing(accessToken, listingId),
      fetchAdminPgListingAnalytics(accessToken, listingId, rangeDays)
    ])
      .then(([d, a]) => {
        if (cancelled) return;
        setDetail(d);
        setAnalytics(a);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
    // rangeDays intentionally excluded — range changes are handled by the effect
    // below so we don't re-fetch the thin detail on every range toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, listingId]);

  // Analytics re-fetch on range change.
  useEffect(() => {
    let cancelled = false;
    setAnalyticsLoading(true);
    fetchAdminPgListingAnalytics(accessToken, listingId, rangeDays)
      .then((a) => {
        if (!cancelled) setAnalytics(a);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setAnalyticsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, listingId, rangeDays]);

  const refetchFull = useCallback(async () => {
    try {
      const f = await fetchAdminPgListingFull(accessToken, listingId);
      setFull(f);
      setFullError(false);
    } catch {
      setFullError(true);
    }
  }, [accessToken, listingId]);

  // Lazy one-shot fetch — called the first time a content tab mounts.
  const ensureFull = useCallback(async () => {
    if (fullRequested.current) return;
    fullRequested.current = true;
    setFullLoading(true);
    await refetchFull();
    setFullLoading(false);
  }, [refetchFull]);

  // Optimistic local merge after a successful mutation.
  const patchFull = useCallback((partial: Partial<PgAdminListingFull>) => {
    setFull((prev) => (prev ? { ...prev, ...partial } : prev));
  }, []);

  return {
    detail,
    setDetail,
    analytics,
    analyticsLoading,
    loadError,
    full,
    fullLoading,
    fullError,
    ensureFull,
    refetchFull,
    patchFull
  };
}
