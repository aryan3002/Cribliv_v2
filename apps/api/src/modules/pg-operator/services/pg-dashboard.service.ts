import { Injectable } from "@nestjs/common";
import type { PgDashboardData } from "@cribliv/shared-types";

/**
 * Narrow slices over OwnerService / AnalyticsService / LeadsService.
 * Adapters in pg-operator.module.ts wire the real services to this shape.
 */
export interface OwnerSlice {
  listOperatorListings(
    operatorId: string
  ): Promise<Array<{ id: string; status: string; updated_at: string }>>;
}
export interface AnalyticsSlice {
  listingMetrics7d(
    listingIds: string[]
  ): Promise<Array<{ listing_id: string; views_7d: number; contact_unlocks_7d: number }>>;
}
export interface LeadsSlice {
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

/**
 * Read-only aggregator. CQRS-lite. Caches per-operator for 60s
 * (Date.now()-based so tests can use fake timers).
 */
@Injectable()
export class PgDashboardService {
  private cache = new Map<string, { at: number; data: PgDashboardData }>();

  constructor(
    private readonly owner: OwnerSlice,
    private readonly analytics: AnalyticsSlice,
    private readonly leads: LeadsSlice
  ) {}

  async getDashboard(operatorId: string): Promise<PgDashboardData> {
    const hit = this.cache.get(operatorId);
    if (hit && Date.now() - hit.at < TTL_MS) {
      return hit.data;
    }

    const listings = await this.owner.listOperatorListings(operatorId);
    const ids = listings.map((l) => l.id);
    const metrics = ids.length ? await this.analytics.listingMetrics7d(ids) : [];
    const leads = await this.leads.inboxForOperator(operatorId);
    const metricsById = new Map(metrics.map((m) => [m.listing_id, m]));

    const data: PgDashboardData = {
      listing_health: listings.map((l) => ({
        listing_id: l.id,
        status: l.status,
        views_7d: metricsById.get(l.id)?.views_7d ?? 0,
        contact_unlocks_7d: metricsById.get(l.id)?.contact_unlocks_7d ?? 0,
        last_updated: l.updated_at
      })),
      leads_inbox: leads
    };

    this.cache.set(operatorId, { at: Date.now(), data });
    return data;
  }
}
