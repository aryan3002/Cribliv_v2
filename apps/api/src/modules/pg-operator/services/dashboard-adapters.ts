import { Inject, Injectable } from "@nestjs/common";
import { PgListingService } from "./pg-listing.service";
import { LeadsService } from "../../leads/leads.service";
import { AnalyticsService } from "../../analytics/analytics.service";
import { PgAnalyticsService } from "./pg-analytics.service";
import { PgAnalyticsOverrideService } from "../../admin/pg-analytics-override.service";
import type { TrendPoint, PgSearchInsights } from "@cribliv/shared-types";

/**
 * Thin adapters mapping real Cribliv services to the narrow ListingsSlice /
 * AnalyticsSlice / LeadsSlice interfaces PgDashboardService consumes.
 * Keeps the dashboard service decoupled from concrete service signatures.
 */
@Injectable()
export class PgListingsSliceAdapter {
  constructor(@Inject(PgListingService) private readonly listings: PgListingService) {}

  // Reads the PG-owned head (pg_listings) — no OwnerService dependency.
  async listOperatorListings(
    operatorId: string
  ): ReturnType<PgListingService["listOperatorListings"]> {
    return this.listings.listOperatorListings(operatorId);
  }

  async listOperatorCities(operatorId: string): Promise<string[]> {
    return this.listings.listOperatorListingCities(operatorId);
  }
}

@Injectable()
export class AnalyticsSliceAdapter {
  constructor(
    @Inject(AnalyticsService) private readonly analytics: AnalyticsService,
    @Inject(PgAnalyticsService) private readonly pgAnalytics: PgAnalyticsService
  ) {}

  // Views per listing over the last 7 days (listing_events). Contact-unlock
  // counts do NOT come from here — a contact unlock writes to contact_unlocks /
  // leads, never to listing_events, so unlocks are counted in LeadsSliceAdapter.
  async listingViews7d(
    listingIds: string[]
  ): Promise<Array<{ listing_id: string; views_7d: number }>> {
    if (!listingIds.length) return [];
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    // One set-based query instead of N per-listing queries (PERF-H3).
    const counts = await this.analytics.getListingEventCountsBatch(listingIds, since);
    return listingIds.map((id) => ({ listing_id: id, views_7d: counts.get(id)?.views ?? 0 }));
  }

  async searchAppearances7d(
    listingIds: string[]
  ): Promise<Array<{ listing_id: string; appearances: number; clicks: number }>> {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return this.pgAnalytics.getSearchAppearances(listingIds, since);
  }

  async funnelTimeseries(
    listingIds: string[],
    days: number
  ): Promise<Array<{ listing_id: string; series: TrendPoint[] }>> {
    return this.pgAnalytics.getFunnelTimeseries(listingIds, days);
  }

  async searchInsights(cities: string[], since: Date): Promise<PgSearchInsights> {
    return this.pgAnalytics.getSearchInsights(cities, since);
  }
}

@Injectable()
export class LeadsSliceAdapter {
  constructor(@Inject(LeadsService) private readonly leads: LeadsService) {}

  // Contact-unlock / interest count per listing over the last 7d, from the leads
  // table (one lead per tenant unlock) — the canonical source the inbox shows.
  async listingLeadCounts7d(
    operatorId: string,
    listingIds: string[]
  ): Promise<Array<{ listing_id: string; count: number }>> {
    if (!listingIds.length) return [];
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return this.leads.getListingLeadCounts(operatorId, listingIds, since);
  }

  async inboxForOperator(operatorId: string): Promise<
    Array<{
      lead_id: string;
      source: string;
      status: string;
      created_at: string;
      contact: { phone_masked: string };
    }>
  > {
    const { items } = await this.leads.getOwnerLeads(operatorId);
    return items.map((r: Record<string, unknown>) => ({
      lead_id: String(r.id ?? r.lead_id ?? ""),
      source: String(r.source ?? "unknown"),
      status: String(r.status ?? "new"),
      created_at: String(r.created_at ?? new Date().toISOString()),
      contact: {
        phone_masked: String((r.contact as { phone_masked?: string })?.phone_masked ?? "***")
      }
    }));
  }
}

@Injectable()
export class OverridesSliceAdapter {
  constructor(
    @Inject(PgAnalyticsOverrideService) private readonly overrides: PgAnalyticsOverrideService
  ) {}
  getActiveForOperator(operatorId: string) {
    return this.overrides.getActiveForOperator(operatorId);
  }
}
