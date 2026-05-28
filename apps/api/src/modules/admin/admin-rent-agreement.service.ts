import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../../common/database.service";
import { readFeatureFlags } from "../../config/feature-flags";
import { RENT_AGREEMENT_SAS_ISSUER } from "../rent-agreement/rent-agreement.module";
import type { SasIssuerPort } from "../rent-agreement/downloads/sas-issuer.port";
import type {
  AdminDownloadLink,
  AgreementDetail,
  AgreementListItem,
  ListAgreementsParams,
  RentAgreementFunnelStep,
  RentAgreementOperational,
  RentAgreementSummary,
  RentAgreementTimePoint
} from "./admin-rent-agreement.types";

// Admin analytics read service for the rent-agreement module. FF-gated:
// `ff_rent_agreement_admin_enabled && db.isEnabled()`. Disabled → null / empty,
// same contract as AdminAnalyticsService.
//
// Revenue is read from rent_agreement_payment_orders (the rent-agreement module's
// own payment table, migration 0029) — status 'paid'.

function toIso(value: unknown): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

// Shared SELECT column list for listAgreements + getAgreementDetail. No PAN columns.
const AGREEMENT_LIST_COLUMNS = `
  ra.id, ra.status, ra.plan_id, ra.locale, ra.current_step,
  ra.owner_full_name, ra.owner_phone, ra.owner_email,
  ra.tenant_full_name, ra.tenant_phone, ra.tenant_email,
  ra.property_full_address, ra.state_code, ra.city,
  ra.rent_amount_paise, ra.stamp_duty_paise, ra.download_count,
  (ra.pdf_blob_path IS NOT NULL) AS pdf_ready,
  ra.created_at, ra.updated_at,
  po.id AS payment_order_id, po.amount_paise AS payment_amount_paise,
  po.status AS payment_status, po.provider AS payment_provider,
  u.phone_e164 AS creator_phone, u.full_name AS creator_name`;

function mapAgreementListItem(r: Record<string, unknown>): AgreementListItem {
  return {
    id: String(r.id),
    status: String(r.status),
    plan_id: String(r.plan_id),
    locale: String(r.locale),
    current_step: Number(r.current_step),
    owner_full_name: (r.owner_full_name as string | null) ?? null,
    owner_phone: (r.owner_phone as string | null) ?? null,
    owner_email: (r.owner_email as string | null) ?? null,
    tenant_full_name: (r.tenant_full_name as string | null) ?? null,
    tenant_phone: (r.tenant_phone as string | null) ?? null,
    tenant_email: (r.tenant_email as string | null) ?? null,
    property_full_address: (r.property_full_address as string | null) ?? null,
    state_code: (r.state_code as string | null) ?? null,
    city: (r.city as string | null) ?? null,
    rent_amount_paise: r.rent_amount_paise == null ? null : Number(r.rent_amount_paise),
    stamp_duty_paise: Number(r.stamp_duty_paise ?? 0),
    download_count: Number(r.download_count ?? 0),
    pdf_ready: Boolean(r.pdf_ready),
    created_at: toIso(r.created_at) ?? "",
    updated_at: toIso(r.updated_at) ?? "",
    payment_order_id: (r.payment_order_id as string | null) ?? null,
    payment_amount_paise: r.payment_amount_paise == null ? null : Number(r.payment_amount_paise),
    payment_status: (r.payment_status as string | null) ?? null,
    payment_provider: (r.payment_provider as string | null) ?? null,
    creator_phone: (r.creator_phone as string | null) ?? null,
    creator_name: (r.creator_name as string | null) ?? null
  };
}

const FUNNEL_LABELS: Record<number, string> = {
  1: "Step 1: Parties",
  2: "Step 2: Property",
  3: "Step 3: Terms",
  4: "Step 4: Inventory & Utilities",
  5: "Step 5: Clauses & Witnesses",
  6: "Step 6: Signatures",
  7: "Step 7: Review"
};

@Injectable()
export class AdminRentAgreementService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(RENT_AGREEMENT_SAS_ISSUER) private readonly sasIssuer: SasIssuerPort
  ) {}

  private get enabled(): boolean {
    return readFeatureFlags().ff_rent_agreement_admin_enabled && this.db.isEnabled();
  }

  private cutoff(days: number): string {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  }

  async getSummary(days = 30): Promise<RentAgreementSummary | null> {
    if (!this.enabled) return null;
    const cutoff = this.cutoff(days);

    const [agg, sessions, revenue, median, byPlan, byState, byLocale, byPayment] =
      await Promise.all([
        this.db.query<{
          drafts_started: number;
          drafts_completed: number;
          drafts_abandoned: number;
          e_sign_completed: number;
          e_stamp_issued: number;
        }>(
          `SELECT
             count(*) FILTER (WHERE created_at >= $1)::int AS drafts_started,
             count(*) FILTER (WHERE created_at >= $1 AND status = 'generated')::int
               AS drafts_completed,
             count(*) FILTER (WHERE status = 'draft'
               AND updated_at < now() - interval '7 days')::int AS drafts_abandoned,
             count(*) FILTER (WHERE created_at >= $1 AND e_sign_completed_at IS NOT NULL)::int
               AS e_sign_completed,
             count(*) FILTER (WHERE created_at >= $1 AND e_stamp_reference IS NOT NULL)::int
               AS e_stamp_issued
           FROM rent_agreements`,
          [cutoff]
        ),
        this.db.query<{ total_sessions: number }>(
          `SELECT count(DISTINCT user_id)::int AS total_sessions
           FROM rent_agreement_event_log
           WHERE event_name = 'ra.session_started' AND created_at >= $1`,
          [cutoff]
        ),
        this.db.query<{ total_revenue_paise: string }>(
          `SELECT COALESCE(SUM(amount_paise), 0)::bigint AS total_revenue_paise
           FROM rent_agreement_payment_orders
           WHERE status = 'paid' AND created_at >= $1`,
          [cutoff]
        ),
        this.db.query<{ avg_completion_ms: number | null }>(
          `SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM (pdf_generated_at - created_at)) * 1000
           ) AS avg_completion_ms
           FROM rent_agreements
           WHERE status = 'generated' AND pdf_generated_at IS NOT NULL AND created_at >= $1`,
          [cutoff]
        ),
        this.db.query<{ plan_id: string; count: number; revenue_paise: string }>(
          `SELECT ra.plan_id,
             count(DISTINCT ra.id)::int AS count,
             COALESCE(SUM(po.amount_paise) FILTER (WHERE po.status = 'paid'), 0)::bigint
               AS revenue_paise
           FROM rent_agreements ra
           LEFT JOIN rent_agreement_payment_orders po ON po.draft_id = ra.id
           WHERE ra.created_at >= $1
           GROUP BY ra.plan_id
           ORDER BY count DESC`,
          [cutoff]
        ),
        this.db.query<{ state_code: string; count: number }>(
          `SELECT state_code, count(*)::int AS count
           FROM rent_agreements
           WHERE created_at >= $1 AND state_code IS NOT NULL
           GROUP BY state_code ORDER BY count DESC LIMIT 10`,
          [cutoff]
        ),
        this.db.query<{ locale: string; count: number }>(
          `SELECT locale, count(*)::int AS count
           FROM rent_agreements
           WHERE created_at >= $1
           GROUP BY locale ORDER BY count DESC`,
          [cutoff]
        ),
        this.db.query<{ status: string; count: number }>(
          `SELECT status, count(*)::int AS count
           FROM rent_agreements
           WHERE created_at >= $1
           GROUP BY status ORDER BY count DESC`,
          [cutoff]
        )
      ]);

    const aggRow = agg.rows[0];
    const draftsStarted = Number(aggRow?.drafts_started ?? 0);
    const draftsCompleted = Number(aggRow?.drafts_completed ?? 0);
    const totalRevenue = Number(revenue.rows[0]?.total_revenue_paise ?? 0);
    const medianMs = median.rows[0]?.avg_completion_ms;

    return {
      total_sessions: Number(sessions.rows[0]?.total_sessions ?? 0),
      drafts_started: draftsStarted,
      drafts_completed: draftsCompleted,
      drafts_abandoned: Number(aggRow?.drafts_abandoned ?? 0),
      conversion_rate: draftsStarted > 0 ? draftsCompleted / draftsStarted : 0,
      total_revenue_paise: totalRevenue,
      arpu_paise: draftsCompleted > 0 ? Math.round(totalRevenue / draftsCompleted) : 0,
      avg_completion_ms: medianMs == null ? null : Number(medianMs),
      by_plan: byPlan.rows.map((r) => ({
        plan_id: r.plan_id,
        count: Number(r.count),
        revenue_paise: Number(r.revenue_paise)
      })),
      by_state: byState.rows.map((r) => ({
        state_code: r.state_code,
        count: Number(r.count)
      })),
      by_locale: byLocale.rows.map((r) => ({ locale: r.locale, count: Number(r.count) })),
      by_payment_status: byPayment.rows.map((r) => ({
        status: r.status,
        count: Number(r.count)
      })),
      e_sign_completed: Number(aggRow?.e_sign_completed ?? 0),
      e_stamp_issued: Number(aggRow?.e_stamp_issued ?? 0)
    };
  }

  async getFunnel(days = 30): Promise<RentAgreementFunnelStep[]> {
    if (!this.enabled) return [];
    const cutoff = this.cutoff(days);

    const [steps, errors] = await Promise.all([
      this.db.query<{
        step: number;
        agreements_reached: number;
        advanced: number;
        blocked_events: number;
        reverted_events: number;
      }>(
        `SELECT step,
           count(DISTINCT agreement_id)::int AS agreements_reached,
           count(DISTINCT agreement_id) FILTER (WHERE outcome = 'advanced')::int AS advanced,
           count(*) FILTER (WHERE outcome = 'blocked')::int AS blocked_events,
           count(*) FILTER (WHERE outcome = 'reverted')::int AS reverted_events
         FROM rent_agreement_step_audit
         WHERE created_at >= $1
         GROUP BY step`,
        [cutoff]
      ),
      this.db.query<{ step: number; code: string; count: number }>(
        `SELECT step, code, count(*)::int AS count
         FROM rent_agreement_step_audit, unnest(error_codes) AS code
         WHERE created_at >= $1 AND outcome = 'blocked'
         GROUP BY step, code
         ORDER BY step, count DESC`,
        [cutoff]
      )
    ]);

    const byStep = new Map<number, (typeof steps.rows)[number]>();
    for (const row of steps.rows) byStep.set(Number(row.step), row);

    const errorsByStep = new Map<number, Array<{ code: string; count: number }>>();
    for (const row of errors.rows) {
      const list = errorsByStep.get(Number(row.step)) ?? [];
      list.push({ code: row.code, count: Number(row.count) });
      errorsByStep.set(Number(row.step), list);
    }

    const reached = (step: number): number => Number(byStep.get(step)?.agreements_reached ?? 0);

    const out: RentAgreementFunnelStep[] = [];
    for (let step = 1; step <= 7; step++) {
      const row = byStep.get(step);
      const reachedHere = reached(step);
      const reachedNext = step < 7 ? reached(step + 1) : 0;
      const dropRaw = reachedHere > 0 ? (reachedHere - reachedNext) / reachedHere : 0;
      const dropRate = step < 7 ? Math.min(1, Math.max(0, dropRaw)) : 0;
      const topErrors = (errorsByStep.get(step) ?? [])
        .slice()
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);
      out.push({
        step,
        label: FUNNEL_LABELS[step],
        agreements_reached: reachedHere,
        advanced: Number(row?.advanced ?? 0),
        blocked_events: Number(row?.blocked_events ?? 0),
        reverted_events: Number(row?.reverted_events ?? 0),
        drop_rate: dropRate,
        top_errors: topErrors
      });
    }
    return out;
  }

  async getTimeSeries(days = 30): Promise<RentAgreementTimePoint[]> {
    if (!this.enabled) return [];
    // generate_series gives one row per day; LEFT JOINs make empty days 0.
    const result = await this.db.query<{
      date: string;
      drafts_started: number;
      drafts_completed: number;
      revenue_paise: string;
    }>(
      `SELECT
         to_char(d.day, 'YYYY-MM-DD') AS date,
         COALESCE(s.started, 0)::int AS drafts_started,
         COALESCE(s.completed, 0)::int AS drafts_completed,
         COALESCE(r.revenue, 0)::bigint AS revenue_paise
       FROM generate_series(
              date_trunc('day', now()) - make_interval(days => $1::int - 1),
              date_trunc('day', now()),
              interval '1 day'
            ) AS d(day)
       LEFT JOIN (
         SELECT date_trunc('day', created_at) AS day,
           count(*) AS started,
           count(*) FILTER (WHERE status = 'generated') AS completed
         FROM rent_agreements
         WHERE created_at >= date_trunc('day', now()) - make_interval(days => $1::int - 1)
         GROUP BY 1
       ) s ON s.day = d.day
       LEFT JOIN (
         SELECT date_trunc('day', created_at) AS day, SUM(amount_paise) AS revenue
         FROM rent_agreement_payment_orders
         WHERE status = 'paid'
           AND created_at >= date_trunc('day', now()) - make_interval(days => $1::int - 1)
         GROUP BY 1
       ) r ON r.day = d.day
       ORDER BY d.day`,
      [days]
    );
    return result.rows.map((row) => ({
      date: row.date,
      drafts_started: Number(row.drafts_started),
      drafts_completed: Number(row.drafts_completed),
      revenue_paise: Number(row.revenue_paise)
    }));
  }

  async getOperational(): Promise<RentAgreementOperational> {
    const empty: RentAgreementOperational = {
      pdf_jobs: { pending: 0, processing: 0, failed: 0, done: 0 },
      expiring_soon: 0,
      total_downloads: 0,
      at_download_limit: 0
    };
    if (!this.enabled) return empty;

    const [jobs, expiring, downloads, atLimit] = await Promise.all([
      this.db.query<{ status: string; count: number }>(
        `SELECT status, count(*)::int AS count FROM rent_agreement_pdf_jobs GROUP BY status`
      ),
      this.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM rent_agreements
         WHERE status = 'generated' AND expires_at IS NOT NULL
           AND expires_at > now() AND expires_at <= now() + interval '7 days'`
      ),
      this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM rent_agreement_downloads`),
      this.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM rent_agreements
         WHERE max_downloads > 0 AND download_count >= max_downloads`
      )
    ]);

    const pdfJobs = { pending: 0, processing: 0, failed: 0, done: 0 };
    for (const row of jobs.rows) {
      if (row.status in pdfJobs) {
        pdfJobs[row.status as keyof typeof pdfJobs] = Number(row.count);
      }
    }
    return {
      pdf_jobs: pdfJobs,
      expiring_soon: Number(expiring.rows[0]?.n ?? 0),
      total_downloads: Number(downloads.rows[0]?.n ?? 0),
      at_download_limit: Number(atLimit.rows[0]?.n ?? 0)
    };
  }

  async listAgreements(
    params: ListAgreementsParams
  ): Promise<{ items: AgreementListItem[]; total: number }> {
    if (!this.enabled) return { items: [], total: 0 };

    const limit = Math.min(100, Math.max(1, Math.trunc(params.limit ?? 20)));
    const page = Math.max(1, Math.trunc(params.page ?? 1));
    const offset = (page - 1) * limit;

    const where: string[] = [];
    const args: unknown[] = [];
    if (params.status) {
      args.push(params.status);
      where.push(`ra.status = $${args.length}`);
    }
    if (params.plan_id) {
      args.push(params.plan_id);
      where.push(`ra.plan_id = $${args.length}`);
    }
    if (params.state_code) {
      args.push(params.state_code);
      where.push(`ra.state_code = $${args.length}`);
    }
    if (params.date_from) {
      args.push(params.date_from);
      where.push(`ra.created_at >= $${args.length}`);
    }
    if (params.date_to) {
      args.push(params.date_to);
      where.push(`ra.created_at <= $${args.length}`);
    }
    if (params.search) {
      args.push(`%${params.search}%`);
      const p = `$${args.length}`;
      where.push(
        `(ra.owner_full_name ILIKE ${p} OR ra.tenant_full_name ILIKE ${p}
          OR ra.owner_phone ILIKE ${p} OR ra.tenant_phone ILIKE ${p}
          OR ra.owner_email ILIKE ${p} OR ra.tenant_email ILIKE ${p})`
      );
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    args.push(limit);
    const limitParam = `$${args.length}`;
    args.push(offset);
    const offsetParam = `$${args.length}`;

    const result = await this.db.query<Record<string, unknown>>(
      `SELECT ${AGREEMENT_LIST_COLUMNS}, count(*) OVER() AS total_count
       FROM rent_agreements ra
       LEFT JOIN rent_agreement_payment_orders po ON po.id = ra.payment_order_id
       LEFT JOIN users u ON u.id = ra.user_id
       ${whereSql}
       ORDER BY ra.created_at DESC
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      args
    );

    const total = result.rows[0] ? Number(result.rows[0].total_count) : 0;
    return { items: result.rows.map(mapAgreementListItem), total };
  }

  async getAgreementDetail(id: string): Promise<AgreementDetail | null> {
    if (!this.enabled) return null;

    const result = await this.db.query<Record<string, unknown>>(
      `SELECT ${AGREEMENT_LIST_COLUMNS},
         ra.step_validated_at, ra.e_stamp_reference, ra.e_sign_session_id,
         ra.e_sign_completed_at, ra.expires_at, ra.pdf_generated_at
       FROM rent_agreements ra
       LEFT JOIN rent_agreement_payment_orders po ON po.id = ra.payment_order_id
       LEFT JOIN users u ON u.id = ra.user_id
       WHERE ra.id = $1`,
      [id]
    );
    const row = result.rows[0];
    if (!row) return null;

    const audit = await this.db.query<{
      step: number;
      outcome: string;
      error_codes: string[];
      created_at: unknown;
    }>(
      `SELECT step, outcome, error_codes, created_at
       FROM rent_agreement_step_audit
       WHERE agreement_id = $1
       ORDER BY created_at`,
      [id]
    );

    return {
      ...mapAgreementListItem(row),
      step_validated_at: (row.step_validated_at as Record<string, string>) ?? {},
      e_stamp_reference: (row.e_stamp_reference as string | null) ?? null,
      e_sign_session_id: (row.e_sign_session_id as string | null) ?? null,
      e_sign_completed_at: toIso(row.e_sign_completed_at),
      expires_at: toIso(row.expires_at),
      pdf_generated_at: toIso(row.pdf_generated_at),
      step_audit: audit.rows.map((a) => ({
        step: Number(a.step),
        outcome: String(a.outcome),
        error_codes: a.error_codes ?? [],
        created_at: toIso(a.created_at) ?? ""
      }))
    };
  }

  // Read-only admin SAS link for a generated PDF. No ownership check, no download
  // counter — admins are already authenticated by the controller's role guard.
  async getAgreementDownloadLink(id: string): Promise<AdminDownloadLink | null> {
    if (!this.enabled) return null;
    const result = await this.db.query<{ pdf_blob_path: string | null }>(
      `SELECT pdf_blob_path FROM rent_agreements WHERE id = $1`,
      [id]
    );
    const blobPath = result.rows[0]?.pdf_blob_path;
    if (!blobPath) return null;
    const issued = await this.sasIssuer.issue({
      blobPath,
      now: new Date(),
      ttlSeconds: 600
    });
    return { sas_url: issued.sasUrl, expires_at: issued.expiresAt.toISOString() };
  }
}
