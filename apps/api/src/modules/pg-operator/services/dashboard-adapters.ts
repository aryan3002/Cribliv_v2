import { Inject, Injectable } from "@nestjs/common";
import { OwnerService } from "../../owner/owner.service";
import { LeadsService } from "../../leads/leads.service";
import { AnalyticsService } from "../../analytics/analytics.service";

/**
 * Thin adapters mapping real Cribliv services to the narrow OwnerSlice /
 * AnalyticsSlice / LeadsSlice interfaces PgDashboardService consumes.
 * Keeps the dashboard service decoupled from concrete service signatures.
 */
@Injectable()
export class OwnerSliceAdapter {
  constructor(@Inject(OwnerService) private readonly owner: OwnerService) {}

  async listOperatorListings(
    operatorId: string
  ): Promise<Array<{ id: string; status: string; updated_at: string }>> {
    const { items } = await this.owner.listOwnerListings(operatorId);
    return items.map((l) => ({
      id: String(l.id ?? ""),
      status: String(l.status ?? ""),
      updated_at: String(l.updated_at ?? new Date().toISOString())
    }));
  }
}

@Injectable()
export class AnalyticsSliceAdapter {
  constructor(@Inject(AnalyticsService) private readonly analytics: AnalyticsService) {}

  async listingMetrics7d(
    listingIds: string[]
  ): Promise<Array<{ listing_id: string; views_7d: number; contact_unlocks_7d: number }>> {
    if (!listingIds.length) return [];
    // Per-listing fetch in parallel. V1: getListingEventCounts returns lifetime;
    // 7d-window narrowing lands in V2 with a dedicated query.
    const results = await Promise.all(
      listingIds.map(async (id) => {
        const counts = await this.analytics.getListingEventCounts(id);
        return {
          listing_id: id,
          views_7d: counts.views,
          contact_unlocks_7d: counts.enquiries
        };
      })
    );
    return results;
  }
}

@Injectable()
export class LeadsSliceAdapter {
  constructor(@Inject(LeadsService) private readonly leads: LeadsService) {}

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
