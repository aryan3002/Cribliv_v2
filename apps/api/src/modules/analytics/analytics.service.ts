import { Inject, Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { readFeatureFlags } from "../../config/feature-flags";

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async trackEvent(params: {
    listing_id: string;
    event_type: string;
    user_id?: string;
    session_id?: string;
    ip?: string;
    user_agent?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const flags = readFeatureFlags();
    if (!flags.ff_listing_analytics_enabled) return;
    if (!this.database.isEnabled()) return;

    try {
      await this.database.query(
        `INSERT INTO listing_events (listing_id, user_id, event_type, session_id, ip, user_agent, metadata)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5::inet, $6, $7::jsonb)`,
        [
          params.listing_id,
          params.user_id ?? null,
          params.event_type,
          params.session_id ?? null,
          params.ip ?? null,
          params.user_agent ?? null,
          JSON.stringify(params.metadata ?? {})
        ]
      );
    } catch (error) {
      this.logger.warn("Failed to track listing event", error);
    }
  }

  async getListingEventCounts(
    listingId: string
  ): Promise<{ views: number; enquiries: number; shortlists: number }> {
    if (!this.database.isEnabled()) {
      return { views: 0, enquiries: 0, shortlists: 0 };
    }

    const result = await this.database.query<{
      event_type: string;
      count: number;
    }>(
      `SELECT event_type, count(*)::int AS count
       FROM listing_events
       WHERE listing_id = $1::uuid AND event_type IN ('view', 'enquiry', 'shortlist')
       GROUP BY event_type`,
      [listingId]
    );

    const counts = { views: 0, enquiries: 0, shortlists: 0 };
    for (const row of result.rows) {
      if (row.event_type === "view") counts.views = row.count;
      if (row.event_type === "enquiry") counts.enquiries = row.count;
      if (row.event_type === "shortlist") counts.shortlists = row.count;
    }
    return counts;
  }
}
