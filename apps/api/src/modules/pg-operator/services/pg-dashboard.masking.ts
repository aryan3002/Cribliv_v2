import type { PgDashboardData, PgActiveOverrides, TrendPoint } from "@cribliv/shared-types";

const round2 = (n: number) => Math.round(n * 100) / 100;
const ratio = (num: number, den: number) => (den > 0 ? round2(num / den) : 0);

const ZERO_TREND = (day: string): TrendPoint => ({
  day,
  appearances: 0,
  clicks: 0,
  views: 0,
  leads: 0
});

/**
 * Read-time, non-destructive masking of an operator's dashboard payload.
 * NEVER mutates the input. Underlying event tables are untouched — flipping the
 * override off restores the full history with no backfill. See spec §2.
 */
export function applyMasking(data: PgDashboardData, ov: PgActiveOverrides): PgDashboardData {
  if (!ov.global && ov.listing_ids.length === 0) return data;

  const cut = new Set(ov.listing_ids);
  const isCut = (l: PgDashboardData["listing_health"][number]) =>
    ov.global || cut.has(l.listing_id);

  const listing_health = data.listing_health.map((l) =>
    isCut(l)
      ? {
          ...l,
          views_7d: 0,
          contact_unlocks_7d: 0,
          search_appearances_7d: 0,
          ctr_7d: 0,
          interest_rate_7d: 0,
          trend_7d: l.trend_7d.map((p) => ZERO_TREND(p.day))
        }
      : l
  );

  // Portfolio recompute from surviving (non-cut) listings only.
  // Uses per-listing scalar fields (views_7d, contact_unlocks_7d,
  // search_appearances_7d) — more reliable than trend_7d which may be empty.
  const survivors = data.listing_health.filter((l) => !isCut(l));
  const portfolio = computePortfolioFromListings(survivors);

  // When global, blank trend_30d and insights entirely; per-PG keeps the global
  // shape but zeroes the cut contribution (we cannot decompose trend_30d per
  // listing here, so per-PG zeroes trend_30d only if all listings are cut).
  const allCut = data.listing_health.length > 0 && survivors.length === 0;
  const trend_30d =
    ov.global || allCut ? data.trend_30d.map((p) => ZERO_TREND(p.day)) : data.trend_30d;
  const search_insights = ov.global
    ? { top_queries: [], top_filters: [], zero_result_queries: [] }
    : data.search_insights;

  return {
    ...data,
    analytics_status: "restricted",
    listing_health,
    portfolio: ov.global ? zeroPortfolio() : portfolio,
    trend_30d,
    search_insights
  };
}

function zeroPortfolio(): PgDashboardData["portfolio"] {
  return {
    appearances: 0,
    clicks: 0,
    views: 0,
    leads: 0,
    ctr: 0,
    interest_rate: 0,
    conversion: 0,
    deltas: { appearances: null, views: null, leads: null }
  };
}

/** Sum per-listing scalar 7d metrics from surviving listings into a portfolio. */
function computePortfolioFromListings(
  survivors: PgDashboardData["listing_health"]
): PgDashboardData["portfolio"] {
  let appearances = 0,
    views = 0,
    leads = 0;
  for (const l of survivors) {
    appearances += l.search_appearances_7d;
    views += l.views_7d;
    leads += l.contact_unlocks_7d;
  }
  const clicks = Math.round(survivors.reduce((s, l) => s + l.ctr_7d * l.search_appearances_7d, 0));
  return {
    appearances,
    clicks,
    views,
    leads,
    ctr: ratio(clicks, appearances),
    interest_rate: ratio(leads, views),
    conversion: ratio(leads, appearances),
    deltas: { appearances: null, views: null, leads: null }
  };
}
