import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { readFeatureFlags } from "../../config/feature-flags";

/* ──────────────────────────────────────────────────────────────────────
 * AdminOpsService — counters that drive the Live Ops dashboard.
 *
 * Each query is a tight COUNT — designed to run cheaply on a 30s poll
 * even at scale (each table has the right index from earlier migrations).
 * ──────────────────────────────────────────────────────────────────── */

export interface LiveOpsCounters {
  leads_24h: number;
  unlocks_today: number;
  fraud_open: number;
  verifications_pending: number;
  listings_pending_review: number;
  online_voice_sessions: number;
  generated_at: string;
}

@Injectable()
export class AdminOpsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get enabled() {
    return readFeatureFlags().ff_admin_analytics_enabled && this.database.isEnabled();
  }

  async getLiveCounters(): Promise<LiveOpsCounters> {
    if (!this.enabled) {
      return {
        leads_24h: 0,
        unlocks_today: 0,
        fraud_open: 0,
        verifications_pending: 0,
        listings_pending_review: 0,
        online_voice_sessions: 0,
        generated_at: new Date().toISOString()
      };
    }

    const result = await this.database.query<{
      leads_24h: number;
      unlocks_today: number;
      fraud_open: number;
      verifications_pending: number;
      listings_pending_review: number;
      online_voice_sessions: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM leads WHERE created_at >= now() - interval '24 hours') AS leads_24h,
         (SELECT count(*)::int FROM contact_unlocks WHERE created_at::date = now()::date) AS unlocks_today,
         (SELECT count(*)::int FROM fraud_flags WHERE resolved_at IS NULL) AS fraud_open,
         (SELECT count(*)::int FROM verification_attempts WHERE result IN ('pending', 'manual_review')) AS verifications_pending,
         (SELECT count(*)::int FROM listings WHERE status = 'pending_review') AS listings_pending_review,
         (SELECT count(*)::int FROM voice_agent_sessions
            WHERE status = 'active'
              AND updated_at >= now() - interval '5 minutes') AS online_voice_sessions`
    );

    return {
      ...(result.rows[0] ?? {
        leads_24h: 0,
        unlocks_today: 0,
        fraud_open: 0,
        verifications_pending: 0,
        listings_pending_review: 0,
        online_voice_sessions: 0
      }),
      generated_at: new Date().toISOString()
    };
  }

  /** 24-hour hourly trend of contact unlocks — drives the area chart on Live Ops. */
  async getUnlocksHourly(): Promise<Array<{ hour: string; count: number }>> {
    if (!this.enabled) return [];

    const result = await this.database.query<{ hour: string; count: number }>(
      `WITH hours AS (
         SELECT generate_series(
           date_trunc('hour', now() - interval '23 hours'),
           date_trunc('hour', now()),
           interval '1 hour'
         ) AS hour
       )
       SELECT to_char(h.hour, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS hour,
              COALESCE(count(cu.id)::int, 0) AS count
       FROM hours h
       LEFT JOIN contact_unlocks cu
         ON date_trunc('hour', cu.created_at) = h.hour
       GROUP BY h.hour
       ORDER BY h.hour`
    );

    return result.rows;
  }

  /** Last 60 minutes of leads/unlocks/fraud counts in 1-min buckets — for the KPI sparklines. */
  async getRecentActivitySparklines(): Promise<{
    leads: number[];
    unlocks: number[];
    fraud: number[];
  }> {
    if (!this.enabled) return { leads: [], unlocks: [], fraud: [] };

    const buckets = await this.database.query<{
      minute: string;
      leads: number;
      unlocks: number;
      fraud: number;
    }>(
      `WITH minutes AS (
         SELECT generate_series(
           date_trunc('minute', now() - interval '59 minutes'),
           date_trunc('minute', now()),
           interval '1 minute'
         ) AS minute
       )
       SELECT m.minute::text,
              COALESCE((SELECT count(*)::int FROM leads
                        WHERE date_trunc('minute', created_at) = m.minute), 0) AS leads,
              COALESCE((SELECT count(*)::int FROM contact_unlocks
                        WHERE date_trunc('minute', created_at) = m.minute), 0) AS unlocks,
              COALESCE((SELECT count(*)::int FROM fraud_flags
                        WHERE date_trunc('minute', created_at) = m.minute), 0) AS fraud
       FROM minutes m
       ORDER BY m.minute`
    );

    return {
      leads: buckets.rows.map((r) => r.leads),
      unlocks: buckets.rows.map((r) => r.unlocks),
      fraud: buckets.rows.map((r) => r.fraud)
    };
  }
}
