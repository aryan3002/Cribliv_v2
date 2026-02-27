import { Inject, Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { readFeatureFlags } from "../../config/feature-flags";
import type {
  ConversationContext,
  ConversationTurn,
  ParsedFilters,
  SearchIntent
} from "./ai.types";

/**
 * QueryParserService manages multi-turn conversation context and merges
 * successive filter sets so follow-up queries refine the previous search.
 *
 * Example flow:
 *   Turn 1: "2bhk in Noida" → { city: "noida", bhk: 2 }
 *   Turn 2: "under 15k"     → { city: "noida", bhk: 2, max_rent: 15000 }
 */
@Injectable()
export class QueryParserService {
  private readonly logger = new Logger(QueryParserService.name);

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  // ── Session management ──────────────────────────────────────────────────────

  /**
   * Load or create a conversation session.
   * Returns null when the feature flag is off or DB is unavailable.
   */
  async getOrCreateSession(
    sessionToken: string,
    userId?: string
  ): Promise<ConversationContext | null> {
    const flags = readFeatureFlags();
    if (!flags.ff_ai_conversation_context) return null;
    if (!this.database.isEnabled()) return null;

    try {
      // Try to load existing non-expired session
      const existing = await this.database.query<{
        id: string;
        context: ConversationContext["turns"];
        last_intent: string | null;
        last_filters: ParsedFilters;
        turn_count: number;
      }>(
        `SELECT id, context->'turns' AS context, last_intent, last_filters, turn_count
         FROM conversation_sessions
         WHERE session_token = $1 AND expires_at > now()
         LIMIT 1`,
        [sessionToken]
      );

      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        const turns: ConversationTurn[] = Array.isArray(row.context)
          ? (row.context as ConversationTurn[])
          : [];
        return {
          session_id: row.id,
          turns,
          accumulated_filters: row.last_filters ?? {},
          last_intent: (row.last_intent as SearchIntent) ?? "unknown"
        };
      }

      // Create new session
      const created = await this.database.query<{ id: string }>(
        `INSERT INTO conversation_sessions (session_token, user_id, context, last_filters)
         VALUES ($1, $2, '{"turns":[]}', '{}')
         RETURNING id::text`,
        [sessionToken, userId ?? null]
      );

      return {
        session_id: created.rows[0].id,
        turns: [],
        accumulated_filters: {},
        last_intent: "unknown"
      };
    } catch (error) {
      this.logger.error("Failed to get/create conversation session", error);
      return null;
    }
  }

  /**
   * Append a turn and update accumulated filters.
   */
  async appendTurn(
    sessionId: string,
    turn: ConversationTurn,
    newFilters: ParsedFilters,
    intent: SearchIntent
  ): Promise<void> {
    if (!this.database.isEnabled()) return;

    try {
      await this.database.query(
        `UPDATE conversation_sessions
         SET
           context = jsonb_set(context, '{turns}',
             (COALESCE(context->'turns', '[]'::jsonb) || $2::jsonb)),
           last_intent = $3,
           last_filters = $4,
           turn_count = turn_count + 1,
           expires_at = now() + interval '30 minutes'
         WHERE id = $1`,
        [sessionId, JSON.stringify(turn), intent, JSON.stringify(newFilters)]
      );
    } catch (error) {
      this.logger.error("Failed to append conversation turn", error);
    }
  }

  // ── Filter merging ─────────────────────────────────────────────────────────

  /**
   * Merge new filters (from current turn) onto accumulated context filters.
   * New non-undefined values override old ones.
   */
  mergeFilters(accumulated: ParsedFilters, incoming: ParsedFilters): ParsedFilters {
    const merged: ParsedFilters = { ...accumulated };

    for (const key of Object.keys(incoming) as (keyof ParsedFilters)[]) {
      const value = incoming[key];
      if (value !== undefined && value !== null) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (merged as any)[key] = value;
      }
    }

    return merged;
  }

  /**
   * Build a context string from recent turns for the intent classifier prompt.
   * Limits to last 4 turns to stay within token budget.
   */
  buildContextWindow(turns: ConversationTurn[], maxTurns = 4): string {
    if (turns.length === 0) return "";

    const recent = turns.slice(-maxTurns);
    return recent.map((t) => `${t.role}: ${t.content}`).join("\n");
  }
}
