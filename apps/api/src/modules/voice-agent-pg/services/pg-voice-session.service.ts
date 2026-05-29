import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "../../../common/database.service";
import { AppStateService } from "../../../common/app-state.service";
import type { PgExtractedField, VoiceAgentPgPhase } from "@cribliv/shared-types";

export interface StartSessionInput {
  operatorUserId: string;
  locale: "en" | "hi";
  systemPromptVersion: string;
  draftId?: string;
}

export interface TranscriptEntry {
  role: "user" | "agent";
  text: string;
  ts: string;
}

export interface PgVoiceSession {
  id: string;
  operator_user_id: string;
  draft_id: string | null;
  socket_id: string | null;
  phase: VoiceAgentPgPhase;
  locale: "en" | "hi";
  system_prompt_version: string;
  transcript: TranscriptEntry[];
  extraction_log: PgExtractedField[];
  started_at: string;
  ended_at: string | null;
  ttl_expires_at: string;
}

@Injectable()
export class PgVoiceSessionService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AppStateService) private readonly state: AppStateService
  ) {}

  async startSession(input: StartSessionInput): Promise<PgVoiceSession> {
    const now = new Date().toISOString();
    const session: PgVoiceSession = {
      id: randomUUID(),
      operator_user_id: input.operatorUserId,
      draft_id: input.draftId ?? null,
      socket_id: null,
      phase: "greeting",
      locale: input.locale,
      system_prompt_version: input.systemPromptVersion,
      transcript: [],
      extraction_log: [],
      started_at: now,
      ended_at: null,
      ttl_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    };

    if (this.db.isEnabled()) {
      await this.db.query(
        `INSERT INTO pg_voice_agent_sessions
           (id, operator_user_id, draft_id, phase, locale, system_prompt_version,
            transcript, extraction_log, started_at, ttl_expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          session.id,
          session.operator_user_id,
          session.draft_id,
          session.phase,
          session.locale,
          session.system_prompt_version,
          JSON.stringify([]),
          JSON.stringify([]),
          session.started_at,
          session.ttl_expires_at
        ]
      );
    } else {
      this.state.insertPgVoiceSession(session as unknown as Record<string, unknown>);
    }
    return session;
  }

  async appendTranscript(sessionId: string, entry: TranscriptEntry): Promise<void> {
    if (this.db.isEnabled()) {
      await this.db.query(
        `UPDATE pg_voice_agent_sessions
            SET transcript = transcript || $1::jsonb
          WHERE id = $2`,
        [JSON.stringify([entry]), sessionId]
      );
      return;
    }
    const s = this.state.getPgVoiceSession(sessionId) as any;
    if (!s) return;
    s.transcript = [...(s.transcript ?? []), entry];
    this.state.updatePgVoiceSession(sessionId, { transcript: s.transcript });
  }

  async logExtraction(sessionId: string, field: PgExtractedField): Promise<void> {
    if (this.db.isEnabled()) {
      await this.db.query(
        `UPDATE pg_voice_agent_sessions
            SET extraction_log = extraction_log || $1::jsonb
          WHERE id = $2`,
        [JSON.stringify([field]), sessionId]
      );
      return;
    }
    const s = this.state.getPgVoiceSession(sessionId) as any;
    if (!s) return;
    s.extraction_log = [...(s.extraction_log ?? []), field];
    this.state.updatePgVoiceSession(sessionId, { extraction_log: s.extraction_log });
  }

  async updatePhase(sessionId: string, phase: VoiceAgentPgPhase): Promise<void> {
    if (this.db.isEnabled()) {
      await this.db.query(`UPDATE pg_voice_agent_sessions SET phase=$1 WHERE id=$2`, [
        phase,
        sessionId
      ]);
      return;
    }
    this.state.updatePgVoiceSession(sessionId, { phase });
  }

  async endSession(sessionId: string): Promise<void> {
    const now = new Date().toISOString();
    if (this.db.isEnabled()) {
      await this.db.query(`UPDATE pg_voice_agent_sessions SET ended_at=$1 WHERE id=$2`, [
        now,
        sessionId
      ]);
      return;
    }
    this.state.updatePgVoiceSession(sessionId, { ended_at: now });
  }

  getSession(sessionId: string): PgVoiceSession | null {
    return (this.state.getPgVoiceSession(sessionId) as unknown as PgVoiceSession | null) ?? null;
  }
}
