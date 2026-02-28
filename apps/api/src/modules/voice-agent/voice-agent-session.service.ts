import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { randomUUID } from "node:crypto";
import type {
  VoiceAgentPhase,
  VoiceAgentSessionStatus,
  VoiceAgentDraft,
  ConversationTurn,
  VoiceAgentSessionResponse
} from "@cribliv/shared-types";

/* ──────────────────────────────────────────────────────────────────────
 * Required fields that the agent must collect before a listing can
 * proceed to the review / wizard step.
 * ──────────────────────────────────────────────────────────────────── */
export const REQUIRED_LISTING_FIELDS = ["listing_type", "title", "rent", "location.city"] as const;

export const ALL_FIELDS = [
  "listing_type",
  "title",
  "description",
  "rent",
  "deposit",
  "location.city",
  "location.locality",
  "location.address_line1",
  "property_fields.bhk",
  "property_fields.bathrooms",
  "property_fields.area_sqft",
  "property_fields.furnishing",
  "pg_fields.total_beds",
  "pg_fields.room_sharing_options",
  "pg_fields.food_included",
  "pg_fields.attached_bathroom",
  "amenities",
  "preferred_tenant"
] as const;

export interface SessionRow {
  id: string;
  user_id: string;
  session_token: string;
  status: VoiceAgentSessionStatus;
  current_phase: VoiceAgentPhase;
  conversation_turns: ConversationTurn[];
  partial_draft: VoiceAgentDraft;
  fields_collected: string[];
  fields_remaining: string[];
  turn_count: number;
  total_audio_seconds: number;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

@Injectable()
export class VoiceAgentSessionService {
  private readonly logger = new Logger(VoiceAgentSessionService.name);

  /** In-memory fallback when DATABASE_URL is not configured (local dev) */
  private readonly memSessions = new Map<string, SessionRow>();

  constructor(private readonly db: DatabaseService) {}

  /* ────── Create ─────────────────────────────────────────────────── */
  async create(userId: string): Promise<SessionRow> {
    const sessionToken = randomUUID();

    const row: SessionRow = {
      id: randomUUID(),
      user_id: userId,
      session_token: sessionToken,
      status: "active",
      current_phase: "greeting",
      conversation_turns: [],
      partial_draft: {},
      fields_collected: [],
      fields_remaining: [...REQUIRED_LISTING_FIELDS],
      turn_count: 0,
      total_audio_seconds: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    };

    if (!this.db.isEnabled()) {
      this.memSessions.set(row.id, row);
      this.logger.debug(`In-memory session created: ${row.id}`);
      return row;
    }

    await this.db.query(
      `INSERT INTO voice_agent_sessions
        (id, user_id, session_token, status, current_phase,
         conversation_turns, partial_draft, fields_collected,
         fields_remaining, turn_count, total_audio_seconds)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        row.id,
        row.user_id,
        row.session_token,
        row.status,
        row.current_phase,
        JSON.stringify(row.conversation_turns),
        JSON.stringify(row.partial_draft),
        row.fields_collected,
        row.fields_remaining,
        row.turn_count,
        row.total_audio_seconds
      ]
    );

    this.logger.log(`Session created: ${row.id} for user ${userId}`);
    return row;
  }

  /* ────── Find by ID ─────────────────────────────────────────────── */
  async findById(sessionId: string): Promise<SessionRow | null> {
    if (!this.db.isEnabled()) {
      return this.memSessions.get(sessionId) ?? null;
    }

    const res = await this.db.query<SessionRow>(
      `SELECT * FROM voice_agent_sessions WHERE id = $1`,
      [sessionId]
    );
    return res.rows[0] ?? null;
  }

  /* ────── Find active session for user ───────────────────────────── */
  async findActiveForUser(userId: string): Promise<SessionRow | null> {
    if (!this.db.isEnabled()) {
      for (const s of this.memSessions.values()) {
        if (s.user_id === userId && s.status === "active") return s;
      }
      return null;
    }

    const res = await this.db.query<SessionRow>(
      `SELECT * FROM voice_agent_sessions
       WHERE user_id = $1 AND status = 'active' AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    return res.rows[0] ?? null;
  }

  /* ────── Update session state ───────────────────────────────────── */
  async update(
    sessionId: string,
    patch: {
      status?: VoiceAgentSessionStatus;
      current_phase?: VoiceAgentPhase;
      conversation_turns?: ConversationTurn[];
      partial_draft?: VoiceAgentDraft;
      fields_collected?: string[];
      fields_remaining?: string[];
      turn_count?: number;
      total_audio_seconds?: number;
    }
  ): Promise<SessionRow | null> {
    /* ── In-memory path ── */
    if (!this.db.isEnabled()) {
      const existing = this.memSessions.get(sessionId);
      if (!existing) return null;
      const updated: SessionRow = {
        ...existing,
        ...patch,
        updated_at: new Date().toISOString()
      };
      this.memSessions.set(sessionId, updated);
      return updated;
    }

    /* ── Postgres path — build dynamic SET clause ── */
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (patch.status !== undefined) {
      sets.push(`status = $${idx++}`);
      params.push(patch.status);
    }
    if (patch.current_phase !== undefined) {
      sets.push(`current_phase = $${idx++}`);
      params.push(patch.current_phase);
    }
    if (patch.conversation_turns !== undefined) {
      sets.push(`conversation_turns = $${idx++}::jsonb`);
      params.push(JSON.stringify(patch.conversation_turns));
    }
    if (patch.partial_draft !== undefined) {
      sets.push(`partial_draft = $${idx++}::jsonb`);
      params.push(JSON.stringify(patch.partial_draft));
    }
    if (patch.fields_collected !== undefined) {
      sets.push(`fields_collected = $${idx++}`);
      params.push(patch.fields_collected);
    }
    if (patch.fields_remaining !== undefined) {
      sets.push(`fields_remaining = $${idx++}`);
      params.push(patch.fields_remaining);
    }
    if (patch.turn_count !== undefined) {
      sets.push(`turn_count = $${idx++}`);
      params.push(patch.turn_count);
    }
    if (patch.total_audio_seconds !== undefined) {
      sets.push(`total_audio_seconds = $${idx++}`);
      params.push(patch.total_audio_seconds);
    }

    if (sets.length === 0) return this.findById(sessionId);

    params.push(sessionId);
    const res = await this.db.query<SessionRow>(
      `UPDATE voice_agent_sessions SET ${sets.join(", ")}
       WHERE id = $${idx}
       RETURNING *`,
      params
    );

    return res.rows[0] ?? null;
  }

  /* ────── To API response ────────────────────────────────────────── */
  toResponse(row: SessionRow): VoiceAgentSessionResponse {
    return {
      id: row.id,
      status: row.status,
      current_phase: row.current_phase,
      partial_draft: row.partial_draft,
      fields_collected: row.fields_collected,
      fields_remaining: row.fields_remaining,
      turn_count: row.turn_count,
      total_audio_seconds: row.total_audio_seconds,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }
}
