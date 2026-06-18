import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../../common/database.service";
import type { PgListingPayload } from "@cribliv/shared-types";

export interface UpsertDraftInput {
  draft_id?: string;
  payload: PgListingPayload;
  field_confidence?: Record<string, number>;
  source: "manual" | "voice";
  pg_property_id?: string | null;
}

export interface DraftSummary {
  draft_id: string;
  display_name: string;
  updated_at: string;
  committed_listing_id: string | null;
}

@Injectable()
export class PgDraftService {
  private readonly logger = new Logger(PgDraftService.name);

  constructor(private readonly db: DatabaseService) {}

  async upsert(
    operatorId: string,
    input: UpsertDraftInput
  ): Promise<{ draft_id: string; updated_at: string }> {
    if (!this.db.isEnabled()) {
      return { draft_id: `mem-${Date.now()}`, updated_at: new Date().toISOString() };
    }
    const row = await this.db.query<{ id: string; updated_at: string }>(
      `INSERT INTO pg_listing_drafts (id, operator_user_id, pg_property_id, source, payload, field_confidence)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2::uuid, $3::uuid, $4::pg_draft_source, $5::jsonb, $6::jsonb)
       ON CONFLICT (id) DO UPDATE
         SET payload = EXCLUDED.payload,
             field_confidence = EXCLUDED.field_confidence,
             pg_property_id = COALESCE(EXCLUDED.pg_property_id, pg_listing_drafts.pg_property_id),
             updated_at = now()
       RETURNING id::text, updated_at::text`,
      [
        input.draft_id ?? null,
        operatorId,
        input.pg_property_id ?? null,
        input.source,
        JSON.stringify(input.payload),
        JSON.stringify(input.field_confidence ?? {})
      ]
    );
    return { draft_id: row.rows[0].id, updated_at: row.rows[0].updated_at };
  }

  async get(
    operatorId: string,
    draftId: string
  ): Promise<{
    draft_id: string;
    payload: PgListingPayload;
    field_confidence: Record<string, number>;
    updated_at: string;
  } | null> {
    if (!this.db.isEnabled()) return null;
    const r = await this.db.query<{
      id: string;
      payload: PgListingPayload;
      field_confidence: Record<string, number>;
      updated_at: string;
    }>(
      `SELECT id::text AS id, payload, field_confidence, updated_at::text AS updated_at
         FROM pg_listing_drafts
        WHERE id = $1::uuid AND operator_user_id = $2::uuid AND committed_listing_id IS NULL`,
      [draftId, operatorId]
    );
    if (!r.rows[0]) return null;
    return {
      draft_id: r.rows[0].id,
      payload: r.rows[0].payload,
      field_confidence: r.rows[0].field_confidence,
      updated_at: r.rows[0].updated_at
    };
  }

  async list(operatorId: string): Promise<DraftSummary[]> {
    if (!this.db.isEnabled()) return [];
    const r = await this.db.query<DraftSummary>(
      `SELECT id::text AS draft_id,
              -- Name the draft by its per-listing title; fall back to the building
              -- name (older drafts) then a placeholder. Avoids every draft showing
              -- the shared, seeded property name.
              COALESCE(
                NULLIF(payload->>'title',''),
                NULLIF(payload->'property'->>'display_name',''),
                'Untitled PG'
              ) AS display_name,
              updated_at::text AS updated_at,
              committed_listing_id::text AS committed_listing_id
         FROM pg_listing_drafts
        WHERE operator_user_id = $1::uuid AND committed_listing_id IS NULL
        ORDER BY updated_at DESC LIMIT 20`,
      [operatorId]
    );
    return r.rows;
  }

  async remove(operatorId: string, draftId: string): Promise<void> {
    if (!this.db.isEnabled()) return;
    await this.db.query(
      `DELETE FROM pg_listing_drafts WHERE id = $1::uuid AND operator_user_id = $2::uuid`,
      [draftId, operatorId]
    );
  }
}
