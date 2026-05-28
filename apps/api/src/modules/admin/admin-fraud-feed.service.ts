import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { readFeatureFlags } from "../../config/feature-flags";

/* ──────────────────────────────────────────────────────────────────────
 * AdminFraudFeedService — combines raw fraud_flags rows with three
 * synthesized signals so admins see one timeline of what to act on:
 *
 *   1. multi_listing_burst  — same phone created 3+ listings in 24h
 *   2. multi_report          — listing reported by 3+ tenants in 7 days
 *   3. inactive_owner        — owner inactive 60+ days with active listings
 *
 * Each signal carries a stable id so the UI can de-dupe across polls,
 * and a `kind` discriminator so the frontend can route to the right
 * action set (block phone, pause listing, send reminder).
 * ──────────────────────────────────────────────────────────────────── */

export type FraudFeedItemKind =
  | "raw_flag"
  | "multi_listing_burst"
  | "multi_report"
  | "inactive_owner";

export type FraudSeverity = "low" | "medium" | "high";

export interface FraudFeedItem {
  id: string;
  kind: FraudFeedItemKind;
  severity: FraudSeverity;
  summary: string;
  evidence: Record<string, unknown>;
  related_ids: { listing_ids?: string[]; owner_user_id?: string; phone?: string };
  detected_at: string;
}

@Injectable()
export class AdminFraudFeedService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get enabled() {
    return readFeatureFlags().ff_admin_analytics_enabled && this.database.isEnabled();
  }

  async getFeed(limit = 50): Promise<{ items: FraudFeedItem[]; total: number }> {
    if (!this.enabled) return { items: [], total: 0 };

    const cap = Math.min(Math.max(limit, 1), 200);

    const [raw, burst, repeats, inactive] = await Promise.all([
      this.fetchRawFlags(cap),
      this.fetchMultiListingBursts(),
      this.fetchMultiReports(),
      this.fetchInactiveOwners()
    ]);

    const items = [...raw, ...burst, ...repeats, ...inactive].sort(
      (a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime()
    );

    return { items: items.slice(0, cap), total: items.length };
  }

  private async fetchRawFlags(limit: number): Promise<FraudFeedItem[]> {
    const result = await this.database.query<{
      id: string;
      flag_type: string;
      severity: string;
      listing_id: string | null;
      details: Record<string, unknown> | null;
      created_at: string;
    }>(
      `SELECT id::text,
              flag_type::text,
              severity::text,
              listing_id::text,
              details,
              created_at::text
       FROM fraud_flags
       WHERE resolved_at IS NULL
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );

    return result.rows.map((r) => ({
      id: `raw:${r.id}`,
      kind: "raw_flag" as const,
      severity: this.mapSeverity(r.severity),
      summary: this.summarizeRawFlag(r.flag_type, r.details),
      evidence: r.details ?? {},
      related_ids: r.listing_id ? { listing_ids: [r.listing_id] } : {},
      detected_at: r.created_at
    }));
  }

  private async fetchMultiListingBursts(): Promise<FraudFeedItem[]> {
    // A single phone publishing 3+ listings in 24h is brokerish behaviour.
    const result = await this.database.query<{
      phone: string;
      owner_user_id: string;
      listing_count: number;
      listing_ids: string[];
      first_listed_at: string;
    }>(
      `SELECT u.phone_e164 AS phone,
              u.id::text AS owner_user_id,
              count(l.id)::int AS listing_count,
              array_agg(l.id::text ORDER BY l.created_at) AS listing_ids,
              min(l.created_at)::text AS first_listed_at
       FROM listings l
       JOIN users u ON u.id = l.owner_user_id
       WHERE l.created_at >= now() - interval '24 hours'
       GROUP BY u.phone_e164, u.id
       HAVING count(l.id) >= 3
       ORDER BY count(l.id) DESC`
    );

    return result.rows.map((r) => ({
      id: `burst:${r.owner_user_id}:${r.first_listed_at}`,
      kind: "multi_listing_burst" as const,
      severity: r.listing_count >= 5 ? ("high" as const) : ("medium" as const),
      summary: `${r.listing_count} listings from ${r.phone} in the last 24h — likely broker`,
      evidence: { listing_count: r.listing_count, window_hours: 24 },
      related_ids: {
        listing_ids: r.listing_ids,
        owner_user_id: r.owner_user_id,
        phone: r.phone
      },
      detected_at: r.first_listed_at
    }));
  }

  private async fetchMultiReports(): Promise<FraudFeedItem[]> {
    // A listing reported by 3+ distinct tenants in the past week is hot.
    const result = await this.database.query<{
      listing_id: string;
      report_count: number;
      latest_report_at: string;
      reporter_count: number;
    }>(
      `SELECT ff.listing_id::text,
              count(*)::int AS report_count,
              count(DISTINCT ff.reporter_user_id)::int AS reporter_count,
              max(ff.created_at)::text AS latest_report_at
       FROM fraud_flags ff
       WHERE ff.flag_type = 'tenant_report'
         AND ff.created_at >= now() - interval '7 days'
       GROUP BY ff.listing_id
       HAVING count(DISTINCT ff.reporter_user_id) >= 3
       ORDER BY count(*) DESC`
    );

    return result.rows.map((r) => ({
      id: `multireport:${r.listing_id}:${r.latest_report_at}`,
      kind: "multi_report" as const,
      severity: r.reporter_count >= 5 ? ("high" as const) : ("medium" as const),
      summary: `Listing reported by ${r.reporter_count} tenants this week`,
      evidence: { reporter_count: r.reporter_count, report_count: r.report_count, window_days: 7 },
      related_ids: { listing_ids: [r.listing_id] },
      detected_at: r.latest_report_at
    }));
  }

  private async fetchInactiveOwners(): Promise<FraudFeedItem[]> {
    // Owners absent 60+ days while still serving active listings — stale data,
    // tenants get ghosted. Auto-pause is upstream policy; we surface the signal.
    const result = await this.database.query<{
      owner_user_id: string;
      phone: string;
      last_seen: string | null;
      active_listings: number;
    }>(
      `SELECT u.id::text AS owner_user_id,
              u.phone_e164 AS phone,
              u.last_login_at::text AS last_seen,
              count(l.id)::int AS active_listings
       FROM users u
       JOIN listings l ON l.owner_user_id = u.id
       WHERE u.role IN ('owner', 'pg_operator')
         AND l.status = 'active'
         AND (u.last_login_at IS NULL OR u.last_login_at < now() - interval '60 days')
       GROUP BY u.id, u.phone_e164, u.last_login_at
       ORDER BY u.last_login_at NULLS FIRST
       LIMIT 50`
    );

    return result.rows.map((r) => ({
      id: `inactive:${r.owner_user_id}`,
      kind: "inactive_owner" as const,
      severity: "low" as const,
      summary: r.last_seen
        ? `Owner inactive ${this.daysAgo(r.last_seen)}d with ${r.active_listings} active listings`
        : `Owner has never logged in but has ${r.active_listings} active listings`,
      evidence: { last_seen: r.last_seen, active_listings: r.active_listings },
      related_ids: { owner_user_id: r.owner_user_id, phone: r.phone },
      detected_at: r.last_seen ?? new Date(0).toISOString()
    }));
  }

  private mapSeverity(raw: string): FraudSeverity {
    if (raw === "high" || raw === "critical") return "high";
    if (raw === "medium") return "medium";
    return "low";
  }

  private summarizeRawFlag(type: string, details: Record<string, unknown> | null): string {
    switch (type) {
      case "duplicate_listing":
        return "Duplicate listing detected";
      case "tenant_report":
        return `Tenant report: ${(details?.reason as string) ?? "no reason given"}`;
      case "stale":
        return "Listing flagged as stale";
      case "broker_detected":
        return "Broker behaviour detected";
      default:
        return `Flag: ${type}`;
    }
  }

  private daysAgo(iso: string): number {
    return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  }
}
