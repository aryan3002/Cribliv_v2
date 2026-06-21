import { Inject, Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../../common/database.service";

export type PgFunnelEventType =
  | "wizard_started"
  | "step_completed"
  | "geocode_resolved"
  | "photos_added"
  | "draft_saved"
  | "submitted"
  | "published"
  | "abandoned";

export interface PgFunnelEventInput {
  event_type: PgFunnelEventType;
  source: "manual" | "voice";
  step_no?: number | null;
  draft_id?: string | null;
  listing_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface PgFunnelAnalytics {
  range_days: number;
  funnel: {
    wizard_started: number;
    step_completed_by_step: Record<string, number>;
    submitted: number;
    published: number;
    abandoned: number;
  };
  conversion: number;
  publish_conversion: number;
  median_time_to_publish_sec: number | null;
  by_source: { manual: number; voice: number };
  quality: {
    geocode_rate: number;
    avg_photos: number;
    missing_field_heatmap: Array<{ field: string; count: number }>;
  };
  voice: { sessions: number; completion_rate: number; fallback_rate: number };
  score_health: {
    active_pg: number;
    with_score: number;
    without_score: number;
    avg_composite: number | null;
    distribution: Array<{ bucket: string; count: number }>;
  };
}

const safeDiv = (a: number, b: number): number => (b > 0 ? a / b : 0);

/**
 * PG listing-process funnel. `track` writes one append-only event (fire-and-forget,
 * mirrors PgAnalyticsService). `getAnalytics` assembles the admin dashboard
 * aggregate (funnel + conversion + quality + voice + score health) over a window.
 */
@Injectable()
export class PgFunnelService {
  private readonly logger = new Logger(PgFunnelService.name);

  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async track(operatorId: string | null, event: PgFunnelEventInput): Promise<void> {
    if (!this.db.isEnabled()) return;
    try {
      await this.db.query(
        `INSERT INTO pg_listing_funnel_events
           (operator_user_id, draft_id, listing_id, event_type, source, step_no, metadata)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::jsonb)`,
        [
          operatorId ?? null,
          event.draft_id ?? null,
          event.listing_id ?? null,
          event.event_type,
          event.source,
          event.step_no ?? null,
          JSON.stringify(event.metadata ?? {})
        ]
      );
    } catch (error) {
      this.logger.warn("Failed to track pg funnel event", error as Error);
    }
  }

  /**
   * Emit a `published` event for a listing going live (admin approve→active).
   * Looks up the committed draft to recover the originating operator, draft_id
   * (so start→publish time-to-publish joins) and manual/voice source fidelity.
   */
  async trackPublished(listingId: string): Promise<void> {
    if (!this.db.isEnabled()) return;
    try {
      const r = await this.db.query<{ id: string; operator_user_id: string; source: string }>(
        `SELECT id::text AS id, operator_user_id::text AS operator_user_id, source::text AS source
           FROM pg_listing_drafts
          WHERE committed_listing_id = $1::uuid
          ORDER BY updated_at DESC
          LIMIT 1`,
        [listingId]
      );
      const d = r.rows[0];
      await this.track(d?.operator_user_id ?? null, {
        event_type: "published",
        source: d?.source === "voice" ? "voice" : "manual",
        listing_id: listingId,
        draft_id: d?.id ?? null
      });
    } catch (error) {
      this.logger.warn("Failed to track pg published event", error as Error);
    }
  }

  async getAnalytics(days: number): Promise<PgFunnelAnalytics> {
    const empty = this.emptyAnalytics(days);
    if (!this.db.isEnabled()) return empty;

    const since = `${Math.max(1, Math.floor(days))} days`;

    const [rollup, quality, ttp, missing, voice, score] = await Promise.all([
      this.db
        .query<{ event_type: string; source: string; step_no: number | null; c: number }>(
          `/* funnel_rollup */
           SELECT event_type, source, step_no, count(*)::int AS c
             FROM pg_listing_funnel_events
            WHERE created_at >= now() - $1::interval
            GROUP BY event_type, source, step_no`,
          [since]
        )
        .then((r) => r.rows)
        .catch(() => []),
      this.db
        .query<{ geocode_rate: number | null; avg_photos: number | null }>(
          `/* funnel_quality */
           SELECT LEAST(1.0,
                    (count(DISTINCT COALESCE(draft_id::text, operator_user_id::text)) FILTER (WHERE event_type = 'geocode_resolved'))::float
                    / NULLIF(count(DISTINCT COALESCE(draft_id::text, operator_user_id::text)) FILTER (WHERE event_type = 'wizard_started'), 0)
                  ) AS geocode_rate,
                  avg((metadata->>'photo_count')::float) FILTER (WHERE metadata ? 'photo_count') AS avg_photos
             FROM pg_listing_funnel_events
            WHERE created_at >= now() - $1::interval`,
          [since]
        )
        .then((r) => r.rows)
        .catch(() => []),
      this.db
        .query<{ median: number | null }>(
          `/* funnel_ttp */
           SELECT percentile_cont(0.5) WITHIN GROUP (
                    ORDER BY EXTRACT(EPOCH FROM (pub.t - start.t))
                  ) AS median
             FROM (SELECT draft_id, min(created_at) AS t FROM pg_listing_funnel_events
                    WHERE event_type = 'wizard_started' AND draft_id IS NOT NULL
                      AND created_at >= now() - $1::interval GROUP BY draft_id) start
             JOIN (SELECT draft_id, min(created_at) AS t FROM pg_listing_funnel_events
                    WHERE event_type = 'published' AND draft_id IS NOT NULL
                      AND created_at >= now() - $1::interval GROUP BY draft_id) pub
               USING (draft_id)`,
          [since]
        )
        .then((r) => r.rows)
        .catch(() => []),
      this.db
        .query<{ field: string; c: number }>(
          `/* funnel_missing */
           SELECT m.field AS field, count(*)::int AS c
             FROM pg_listing_funnel_events e,
                  jsonb_array_elements_text(e.metadata->'missing') AS m(field)
            WHERE e.created_at >= now() - $1::interval
              AND jsonb_typeof(e.metadata->'missing') = 'array'
            GROUP BY m.field
            ORDER BY c DESC
            LIMIT 20`,
          [since]
        )
        .then((r) => r.rows)
        .catch(() => []),
      this.db
        .query<{ sessions: number; completed: number }>(
          `/* voice_metrics */
           SELECT count(*)::int AS sessions,
                  count(*) FILTER (WHERE ended_at IS NOT NULL)::int AS completed
             FROM pg_voice_agent_sessions
            WHERE started_at >= now() - $1::interval`,
          [since]
        )
        .then((r) => r.rows)
        .catch(() => []),
      this.db
        .query<{
          active_pg: number;
          with_score: number;
          avg_composite: number | null;
          high: number;
          mid: number;
          low: number;
        }>(
          `/* score_health */
           SELECT count(*)::int AS active_pg,
                  count(ls.listing_id)::int AS with_score,
                  avg(ls.composite_score) AS avg_composite,
                  count(*) FILTER (WHERE ls.composite_score >= 0.7)::int AS high,
                  count(*) FILTER (WHERE ls.composite_score >= 0.4 AND ls.composite_score < 0.7)::int AS mid,
                  count(*) FILTER (WHERE ls.composite_score IS NULL OR ls.composite_score < 0.4)::int AS low
             FROM listings l
             LEFT JOIN listing_scores ls ON ls.listing_id = l.id
            WHERE l.listing_type = 'pg' AND l.status = 'active'`,
          []
        )
        .then((r) => r.rows)
        .catch(() => [])
    ]);

    // ── funnel rollup → counts, by_source, step breakdown ──
    const funnel = empty.funnel;
    const by_source = { manual: 0, voice: 0 };
    let submittedVoice = 0;
    let startedVoice = 0;
    for (const row of rollup) {
      const c = Number(row.c) || 0;
      switch (row.event_type) {
        case "wizard_started":
          funnel.wizard_started += c;
          if (row.source === "voice") {
            by_source.voice += c;
            startedVoice += c;
          } else by_source.manual += c;
          break;
        case "step_completed":
          if (row.step_no != null) {
            const k = String(row.step_no);
            funnel.step_completed_by_step[k] = (funnel.step_completed_by_step[k] ?? 0) + c;
          }
          break;
        case "submitted":
          funnel.submitted += c;
          if (row.source === "voice") submittedVoice += c;
          break;
        case "published":
          funnel.published += c;
          break;
        case "abandoned":
          funnel.abandoned += c;
          break;
      }
    }

    const q = quality[0] ?? { geocode_rate: 0, avg_photos: 0 };
    const v = voice[0] ?? { sessions: 0, completed: 0 };
    const s = score[0] ?? {
      active_pg: 0,
      with_score: 0,
      avg_composite: null,
      high: 0,
      mid: 0,
      low: 0
    };

    return {
      range_days: days,
      funnel,
      conversion: safeDiv(funnel.submitted, funnel.wizard_started),
      publish_conversion: safeDiv(funnel.published, funnel.wizard_started),
      median_time_to_publish_sec: ttp[0]?.median != null ? Number(ttp[0].median) : null,
      by_source,
      quality: {
        geocode_rate: q.geocode_rate != null ? Number(q.geocode_rate) : 0,
        avg_photos: q.avg_photos != null ? Number(q.avg_photos) : 0,
        missing_field_heatmap: missing.map((m) => ({ field: m.field, count: Number(m.c) || 0 }))
      },
      voice: {
        sessions: Number(v.sessions) || 0,
        completion_rate: safeDiv(Number(v.completed) || 0, Number(v.sessions) || 0),
        fallback_rate: startedVoice > 0 ? 1 - safeDiv(submittedVoice, startedVoice) : 0
      },
      score_health: {
        active_pg: Number(s.active_pg) || 0,
        with_score: Number(s.with_score) || 0,
        without_score: (Number(s.active_pg) || 0) - (Number(s.with_score) || 0),
        avg_composite: s.avg_composite != null ? Number(s.avg_composite) : null,
        distribution: [
          { bucket: "high", count: Number(s.high) || 0 },
          { bucket: "mid", count: Number(s.mid) || 0 },
          { bucket: "low", count: Number(s.low) || 0 }
        ]
      }
    };
  }

  private emptyAnalytics(days: number): PgFunnelAnalytics {
    return {
      range_days: days,
      funnel: {
        wizard_started: 0,
        step_completed_by_step: {},
        submitted: 0,
        published: 0,
        abandoned: 0
      },
      conversion: 0,
      publish_conversion: 0,
      median_time_to_publish_sec: null,
      by_source: { manual: 0, voice: 0 },
      quality: { geocode_rate: 0, avg_photos: 0, missing_field_heatmap: [] },
      voice: { sessions: 0, completion_rate: 0, fallback_rate: 0 },
      score_health: {
        active_pg: 0,
        with_score: 0,
        without_score: 0,
        avg_composite: null,
        distribution: [
          { bucket: "high", count: 0 },
          { bucket: "mid", count: 0 },
          { bucket: "low", count: 0 }
        ]
      }
    };
  }
}
