import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "../../../common/database.service";
import { AppStateService } from "../../../common/app-state.service";
import type { PgVoiceToolName } from "@cribliv/shared-types";

export interface CommitInput {
  operatorUserId: string;
  pgPropertyId: string;
  draftId?: string;
  toolName: PgVoiceToolName;
  extracted: Array<{ field: string; value: unknown; confidence: number }>;
}

interface DraftRow {
  id: string;
  operator_user_id: string;
  pg_property_id: string;
  source: "voice" | "manual" | "imported";
  payload: {
    property: Record<string, unknown>;
    pg_details: Record<string, unknown>;
    room_types: unknown[];
  };
  field_confidence: Record<string, number>;
  committed_listing_id: string | null;
  created_at: string;
  updated_at: string;
  ttl_expires_at: string;
}

/**
 * Bridges tool outputs to pg_listing_drafts. Recognises the special path
 * "room_types.cell" → append to room_types[]; dot-paths otherwise.
 */
@Injectable()
export class PgExtractionService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AppStateService) private readonly state: AppStateService
  ) {}

  async commitExtraction(input: CommitInput): Promise<string> {
    let draftId = input.draftId;
    let draft = draftId
      ? (this.state.getPgListingDraft(draftId) as unknown as DraftRow | null)
      : null;

    if (!draft) {
      draftId = randomUUID();
      const now = new Date().toISOString();
      draft = {
        id: draftId,
        operator_user_id: input.operatorUserId,
        pg_property_id: input.pgPropertyId,
        source: "voice",
        payload: { property: {}, pg_details: {}, room_types: [] },
        field_confidence: {},
        committed_listing_id: null,
        created_at: now,
        updated_at: now,
        ttl_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      };
      this.state.insertPgListingDraft(draft as unknown as Record<string, unknown>);
    }

    for (const e of input.extracted) {
      this.applyField(draft, e.field, e.value);
      draft.field_confidence[e.field] = e.confidence;
    }
    draft.updated_at = new Date().toISOString();
    this.state.insertPgListingDraft(draft as unknown as Record<string, unknown>);

    if (this.db.isEnabled()) {
      await this.db.query(
        `INSERT INTO pg_listing_drafts
           (id, operator_user_id, pg_property_id, source, payload, field_confidence,
            created_at, updated_at, ttl_expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET
           payload = EXCLUDED.payload,
           field_confidence = EXCLUDED.field_confidence,
           updated_at = EXCLUDED.updated_at`,
        [
          draft.id,
          draft.operator_user_id,
          draft.pg_property_id,
          draft.source,
          JSON.stringify(draft.payload),
          JSON.stringify(draft.field_confidence),
          draft.created_at,
          draft.updated_at,
          draft.ttl_expires_at
        ]
      );
    }
    return draftId!;
  }

  /** Sets a nested field by dot-path. "room_types.cell" is a special append op. */
  private applyField(draft: DraftRow, field: string, value: unknown): void {
    if (field === "room_types.cell") {
      if (!Array.isArray(draft.payload.room_types)) draft.payload.room_types = [];
      draft.payload.room_types.push(value);
      return;
    }
    const parts = field.split(".");
    let cur: Record<string, unknown> = draft.payload as unknown as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      if (cur[k] == null || typeof cur[k] !== "object") {
        cur[k] = {};
      }
      cur = cur[k] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]] = value;
  }
}
