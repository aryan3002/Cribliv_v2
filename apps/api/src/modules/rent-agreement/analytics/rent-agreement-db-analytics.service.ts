// DB-backed analytics for the rent-agreement module. Writes the event log +
// step audit that the admin analytics dashboard reads.
//
// Contract: NEVER throws. Analytics is best-effort — a failed write must not break
// the user-facing request. DB errors are caught and surfaced via logTelemetry
// ("ra.analytics_write_failed") rather than silently swallowed.

import type { DatabaseService } from "../../../common/database.service";
import { logTelemetry } from "../../../common/telemetry";
import type { RentAgreementAnalyticsPort, StepAuditEntry } from "../plans/null-analytics";

export class RentAgreementDbAnalyticsService implements RentAgreementAnalyticsPort {
  constructor(private readonly db: DatabaseService) {}

  async emit(eventName: string, properties: Record<string, unknown>): Promise<void> {
    if (!this.db.isEnabled()) return;
    const agreementId = (properties.agreement_id as string | undefined) ?? null;
    const userId = (properties.user_id as string | undefined) ?? null;
    try {
      if (eventName === "ra.session_started") {
        // Dedupe: at most one session row per user per calendar day. The frontend
        // polls GET /my, which would otherwise inflate the session count.
        await this.db.query(
          `INSERT INTO rent_agreement_event_log (event_name, agreement_id, user_id, properties)
           SELECT $1, $2, $3, $4::jsonb
           WHERE $3::uuid IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM rent_agreement_event_log
               WHERE user_id = $3::uuid
                 AND event_name = 'ra.session_started'
                 AND created_at >= date_trunc('day', now())
             )`,
          [eventName, agreementId, userId, JSON.stringify(properties)]
        );
      } else {
        await this.db.query(
          `INSERT INTO rent_agreement_event_log (event_name, agreement_id, user_id, properties)
           VALUES ($1, $2, $3, $4::jsonb)`,
          [eventName, agreementId, userId, JSON.stringify(properties)]
        );
      }
    } catch (err) {
      logTelemetry("ra.analytics_write_failed", {
        event: eventName,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  async emitStepAudit(entry: StepAuditEntry): Promise<void> {
    if (!this.db.isEnabled()) return;
    try {
      await this.db.query(
        `INSERT INTO rent_agreement_step_audit
           (agreement_id, step, outcome, error_codes, actor_user_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [
          entry.agreementId,
          entry.step,
          entry.outcome,
          entry.errorCodes ?? [],
          entry.actorUserId,
          JSON.stringify(entry.metadata ?? {})
        ]
      );
    } catch (err) {
      logTelemetry("ra.analytics_write_failed", {
        event: "step_audit",
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
}
