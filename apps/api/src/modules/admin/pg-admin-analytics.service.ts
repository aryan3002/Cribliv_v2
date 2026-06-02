import { Inject, Injectable } from "@nestjs/common";
import { PgFunnelService, type PgFunnelAnalytics } from "../pg-operator/services/pg-funnel.service";

/**
 * Admin-facing PG listing-process analytics. Delegates the heavy aggregate to
 * PgFunnelService (which already folds in funnel + quality + voice + score
 * health per Plan 3 R6); this seam exists so future cross-module admin reads
 * have a home without bloating the operator-owned funnel service.
 */
@Injectable()
export class PgAdminAnalyticsService {
  constructor(@Inject(PgFunnelService) private readonly funnel: PgFunnelService) {}

  async getListingAnalytics(days: number): Promise<PgFunnelAnalytics> {
    const window = Number.isFinite(days) && days > 0 ? Math.min(365, Math.floor(days)) : 30;
    return this.funnel.getAnalytics(window);
  }
}
