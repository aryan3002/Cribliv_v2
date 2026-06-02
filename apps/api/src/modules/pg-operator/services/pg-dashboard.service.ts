import { Injectable } from "@nestjs/common";
import type {
  PgDashboardData,
  TrendPoint,
  PgPortfolioSummary,
  PgSearchInsights
} from "@cribliv/shared-types";

/**
 * Narrow slices over PgListingService / AnalyticsService / LeadsService.
 * Adapters in pg-operator.module.ts wire the real services to this shape.
 */
export interface ListingsSlice {
  listOperatorListings(
    operatorId: string
  ): Promise<Array<{ id: string; status: string; updated_at: string; composite_score?: number }>>;
  // Distinct city slugs the operator lists in — scopes demand insights.
  listOperatorCities(operatorId: string): Promise<string[]>;
}
export interface AnalyticsSlice {
  listingViews7d(listingIds: string[]): Promise<Array<{ listing_id: string; views_7d: number }>>;
  searchAppearances7d(
    listingIds: string[]
  ): Promise<Array<{ listing_id: string; appearances: number; clicks: number }>>;
  funnelTimeseries(
    listingIds: string[],
    days: number
  ): Promise<Array<{ listing_id: string; series: TrendPoint[] }>>;
  searchInsights(cities: string[], since: Date): Promise<PgSearchInsights>;
}
export interface LeadsSlice {
  // Contact-unlock / interest count per listing (last 7d), sourced from the
  // leads table — one lead per tenant unlock — so the card matches the inbox.
  listingLeadCounts7d(
    operatorId: string,
    listingIds: string[]
  ): Promise<Array<{ listing_id: string; count: number }>>;
  inboxForOperator(operatorId: string): Promise<
    Array<{
      lead_id: string;
      source: string;
      status: string;
      created_at: string;
      contact: { phone_masked: string };
    }>
  >;
}

const TTL_MS = 60_000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const ratio = (num: number, den: number) => (den > 0 ? round2(num / den) : 0);
// % change vs prior period; null when there's no baseline to compare against.
const deltaPct = (cur: number, prior: number) => (prior > 0 ? round2((cur - prior) / prior) : null);

const EMPTY_INSIGHTS: PgSearchInsights = {
  top_queries: [],
  top_filters: [],
  zero_result_queries: []
};
const ZERO_PORTFOLIO: PgPortfolioSummary = {
  appearances: 0,
  clicks: 0,
  views: 0,
  leads: 0,
  ctr: 0,
  interest_rate: 0,
  conversion: 0,
  deltas: { appearances: null, views: null, leads: null }
};

/**
 * Read-only aggregator. CQRS-lite. Caches per-operator for 60s
 * (Date.now()-based so tests can use fake timers).
 */
@Injectable()
export class PgDashboardService {
  private cache = new Map<string, { at: number; data: PgDashboardData }>();

  constructor(
    private readonly listings: ListingsSlice,
    private readonly analytics: AnalyticsSlice,
    private readonly leads: LeadsSlice
  ) {}

  async getDashboard(operatorId: string): Promise<PgDashboardData> {
    const hit = this.cache.get(operatorId);
    if (hit && Date.now() - hit.at < TTL_MS) {
      return hit.data;
    }

    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const listings = await this.listings.listOperatorListings(operatorId);
    const cities = await this.listings.listOperatorCities(operatorId);
    const ids = listings.map((l) => l.id);

    const [views, appearances, trends, unlockCounts, leads, insights] = await Promise.all([
      ids.length ? this.analytics.listingViews7d(ids) : Promise.resolve([]),
      ids.length ? this.analytics.searchAppearances7d(ids) : Promise.resolve([]),
      ids.length ? this.analytics.funnelTimeseries(ids, 30) : Promise.resolve([]),
      ids.length ? this.leads.listingLeadCounts7d(operatorId, ids) : Promise.resolve([]),
      this.leads.inboxForOperator(operatorId),
      cities.length
        ? this.analytics.searchInsights(cities, since7d)
        : Promise.resolve(EMPTY_INSIGHTS)
    ]);

    const viewsById = new Map(views.map((v) => [v.listing_id, v.views_7d]));
    const apprById = new Map(appearances.map((a) => [a.listing_id, a]));
    const trendById = new Map(trends.map((t) => [t.listing_id, t.series]));
    const unlocksById = new Map(unlockCounts.map((u) => [u.listing_id, u.count]));

    const trend30 = this.aggregateTrend(trends.map((t) => t.series));
    const portfolio = this.computePortfolio(trend30);

    const data: PgDashboardData = {
      listing_health: listings.map((l) => {
        const views_7d = viewsById.get(l.id) ?? 0;
        const appr = apprById.get(l.id);
        const appearances_7d = appr?.appearances ?? 0;
        const clicks_7d = appr?.clicks ?? 0;
        const contact_unlocks_7d = unlocksById.get(l.id) ?? 0;
        const series = trendById.get(l.id) ?? [];
        return {
          listing_id: l.id,
          status: l.status,
          views_7d,
          contact_unlocks_7d,
          search_appearances_7d: appearances_7d,
          ctr_7d: ratio(clicks_7d, appearances_7d),
          interest_rate_7d: ratio(contact_unlocks_7d, views_7d),
          trend_7d: series.slice(-7),
          last_updated: l.updated_at,
          composite_score: l.composite_score
        };
      }),
      leads_inbox: leads,
      portfolio,
      trend_30d: trend30,
      search_insights: insights
    };

    this.cache.set(operatorId, { at: Date.now(), data });
    return data;
  }

  /** Sum the per-listing day grids element-wise into one portfolio series. */
  private aggregateTrend(seriesList: TrendPoint[][]): TrendPoint[] {
    const len = seriesList.reduce((m, s) => Math.max(m, s.length), 0);
    if (len === 0) return [];
    return Array.from({ length: len }, (_, i) => {
      let day = "";
      let appearances = 0;
      let clicks = 0;
      let views = 0;
      let leads = 0;
      for (const s of seriesList) {
        const p = s[i];
        if (!p) continue;
        day = day || p.day;
        appearances += p.appearances;
        clicks += p.clicks;
        views += p.views;
        leads += p.leads;
      }
      return { day, appearances, clicks, views, leads };
    });
  }

  /** Last-7 totals + ratios, with week-over-week deltas vs the prior 7 days. */
  private computePortfolio(trend30: TrendPoint[]): PgPortfolioSummary {
    if (!trend30.length) return ZERO_PORTFOLIO;
    const sum = (arr: TrendPoint[]) =>
      arr.reduce(
        (s, p) => ({
          a: s.a + p.appearances,
          c: s.c + p.clicks,
          v: s.v + p.views,
          l: s.l + p.leads
        }),
        { a: 0, c: 0, v: 0, l: 0 }
      );
    const cur = sum(trend30.slice(-7));
    const prior = sum(trend30.slice(-14, -7));
    return {
      appearances: cur.a,
      clicks: cur.c,
      views: cur.v,
      leads: cur.l,
      ctr: ratio(cur.c, cur.a),
      interest_rate: ratio(cur.l, cur.v),
      conversion: ratio(cur.l, cur.a),
      deltas: {
        appearances: deltaPct(cur.a, prior.a),
        views: deltaPct(cur.v, prior.v),
        leads: deltaPct(cur.l, prior.l)
      }
    };
  }
}
