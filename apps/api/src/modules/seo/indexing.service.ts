import { Injectable, Logger, Optional } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { readFeatureFlags } from "../../config/feature-flags";
import { GoogleServiceAuth } from "./google/google-service-auth";

const INDEXING_SCOPE = "https://www.googleapis.com/auth/indexing";
const PUBLISH_ENDPOINT = "https://indexing.googleapis.com/v3/urlNotifications:publish";
const MAX_ATTEMPTS_BEFORE_FAIL = 5;

export interface SeoIndexingQueueRow {
  id: string;
  url: string;
  status: "pending" | "submitted" | "failed" | "skipped";
  reason: string | null;
  attempts: number;
  submitted_at: string | null;
  response: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

const QUEUE_ROW_COLUMNS = `id::text, url, status, reason, attempts,
       submitted_at::text AS submitted_at, response,
       created_at::text AS created_at, updated_at::text AS updated_at`;

@Injectable()
export class IndexingService {
  private readonly logger = new Logger(IndexingService.name);
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly database: DatabaseService,
    private readonly auth: GoogleServiceAuth,
    @Optional() fetchImpl?: typeof fetch
  ) {
    this.fetchImpl = fetchImpl ?? fetch;
  }

  async enqueue(url: string, reason: string): Promise<SeoIndexingQueueRow | null> {
    if (!this.database.isEnabled()) return null;

    const { rows } = await this.database.query<SeoIndexingQueueRow>(
      `INSERT INTO seo_indexing_queue (url, reason)
       VALUES ($1, $2)
       ON CONFLICT (url) DO UPDATE SET
         reason = EXCLUDED.reason,
         status = 'pending',
         updated_at = now()
       RETURNING ${QUEUE_ROW_COLUMNS}`,
      [url, reason]
    );
    return rows[0] ?? null;
  }

  async submittedCountToday(): Promise<number> {
    if (!this.database.isEnabled()) return 0;
    const { rows } = await this.database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM seo_indexing_queue
       WHERE status = 'submitted' AND submitted_at >= date_trunc('day', now())`,
      []
    );
    return rows[0]?.count ?? 0;
  }

  async drainPending(
    quota: number,
    submittedToday: number
  ): Promise<{ submitted: number; failed: number; skippedQuota: number }> {
    if (!readFeatureFlags().ff_seo_indexing || !this.database.isEnabled()) {
      return { submitted: 0, failed: 0, skippedQuota: 0 };
    }

    const remaining = Math.max(0, quota - submittedToday);
    if (remaining === 0) {
      return { submitted: 0, failed: 0, skippedQuota: 0 };
    }

    const { rows: pending } = await this.database.query<{
      id: string;
      url: string;
      attempts: number;
    }>(
      `SELECT id::text, url, attempts FROM seo_indexing_queue
       WHERE status = 'pending'
       ORDER BY created_at DESC
       LIMIT $1`,
      [remaining + 1]
    );

    const toSubmit = pending.slice(0, remaining);
    const skippedQuota = Math.max(0, pending.length - remaining);
    let submitted = 0;
    let failed = 0;

    for (const row of toSubmit) {
      try {
        const token = await this.auth.getAccessToken([INDEXING_SCOPE]);
        const response = await this.fetchImpl(PUBLISH_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ url: row.url, type: "URL_UPDATED" })
        });

        if (response.ok) {
          const body = await response.json().catch(() => ({}));
          await this.database.query(
            `UPDATE seo_indexing_queue
             SET status = 'submitted', submitted_at = now(), response = $2::jsonb, updated_at = now()
             WHERE id = $1`,
            [row.id, JSON.stringify(body)]
          );
          submitted += 1;
        } else {
          const detail = await response.text().catch(() => "");
          await this.markFailedAttempt(row.id, row.attempts, {
            status: response.status,
            detail
          });
          failed += 1;
        }
      } catch (err) {
        this.logger.warn(
          `indexing_submitter row ${row.id} (${row.url}) errored: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        try {
          await this.markFailedAttempt(row.id, row.attempts, {
            error: err instanceof Error ? err.message : String(err)
          });
          failed += 1;
        } catch {
          // Leave the row pending if even the failure update cannot be persisted.
        }
      }
    }

    return { submitted, failed, skippedQuota };
  }

  async listQueue(params: {
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: SeoIndexingQueueRow[]; total: number }> {
    if (!this.database.isEnabled()) return { items: [], total: 0 };

    const limit = Math.min(200, Math.max(1, params.limit ?? 50));
    const offset = Math.max(0, params.offset ?? 0);
    const whereClause = params.status ? "WHERE status = $1" : "";
    const queryParams: unknown[] = params.status ? [params.status, limit, offset] : [limit, offset];
    const limitIdx = params.status ? "$2" : "$1";
    const offsetIdx = params.status ? "$3" : "$2";

    const { rows } = await this.database.query<SeoIndexingQueueRow>(
      `SELECT ${QUEUE_ROW_COLUMNS} FROM seo_indexing_queue
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ${limitIdx} OFFSET ${offsetIdx}`,
      queryParams
    );

    const countParams = params.status ? [params.status] : [];
    const { rows: countRows } = await this.database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM seo_indexing_queue ${whereClause}`,
      countParams
    );

    return { items: rows, total: countRows[0]?.count ?? 0 };
  }

  async retry(id: string): Promise<SeoIndexingQueueRow | null> {
    if (!this.database.isEnabled()) return null;
    const { rows } = await this.database.query<SeoIndexingQueueRow>(
      `UPDATE seo_indexing_queue
       SET status = 'pending', updated_at = now()
       WHERE id = $1
       RETURNING ${QUEUE_ROW_COLUMNS}`,
      [id]
    );
    return rows[0] ?? null;
  }

  private async markFailedAttempt(
    id: string,
    currentAttempts: number,
    response: Record<string, unknown>
  ): Promise<void> {
    const nextAttempts = currentAttempts + 1;
    const nextStatus = nextAttempts >= MAX_ATTEMPTS_BEFORE_FAIL ? "failed" : "pending";
    await this.database.query(
      `UPDATE seo_indexing_queue
       SET status = '${nextStatus}', attempts = attempts + 1, response = $2::jsonb, updated_at = now()
       WHERE id = $1`,
      [id, JSON.stringify(response)]
    );
  }
}
