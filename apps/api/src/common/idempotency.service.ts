import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "./database.service";

/**
 * Replay-safe idempotency for mutating endpoints, backed by the
 * `idempotency_keys` table (migration 0002), wrapping the equivalent private
 * logic already proven in OwnerService.
 *
 * `run()` executes a unit of work so that a retry with the same
 * (actor, route, key) returns the cached response instead of re-executing —
 * preventing duplicate rows on double-submit / network-retry (audit BUG-H1).
 *
 * No-op passthrough (always runs `fn`) when the DB is disabled (local/in-memory
 * mode). Note: this is a check-then-act cache (same semantics as the owner
 * path) — it covers sequential retries, not two truly-simultaneous first calls.
 */
@Injectable()
export class IdempotencyService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async run<T>(
    actorUserId: string,
    route: string,
    idemKey: string,
    fn: () => Promise<T>
  ): Promise<T> {
    if (!this.database.isEnabled()) {
      return fn();
    }
    const cached = await this.get(actorUserId, route, idemKey);
    if (cached != null) {
      return cached as T;
    }
    const result = await fn();
    await this.store(actorUserId, route, idemKey, result);
    return result;
  }

  private async get(actorUserId: string, route: string, idemKey: string): Promise<unknown> {
    const result = await this.database.query<{ response: unknown }>(
      `
      SELECT response
      FROM idempotency_keys
      WHERE actor_user_id = $1::uuid AND route = $2 AND idem_key = $3 AND expires_at > now()
      LIMIT 1
      `,
      [actorUserId, route, idemKey]
    );
    return result.rows[0]?.response ?? null;
  }

  private async store(
    actorUserId: string,
    route: string,
    idemKey: string,
    response: unknown
  ): Promise<void> {
    await this.database.query(
      `
      INSERT INTO idempotency_keys(actor_user_id, route, idem_key, response, expires_at)
      VALUES ($1::uuid, $2, $3, $4::jsonb, now() + interval '24 hours')
      ON CONFLICT (actor_user_id, route, idem_key) DO NOTHING
      `,
      [actorUserId, route, idemKey, JSON.stringify(response)]
    );
  }
}

/**
 * Fallback used when the service isn't injected — e.g. lightweight unit/integration
 * tests that build a Nest module without `CoreModule`. The real, DB-backed service
 * is `@Global` (CoreModule) so production ALWAYS gets it; this just runs the work
 * un-deduplicated so a controller stays usable when idempotency isn't wired.
 */
export const PASSTHROUGH_IDEMPOTENCY: Pick<IdempotencyService, "run"> = {
  run: <T>(_actorUserId: string, _route: string, _idemKey: string, fn: () => Promise<T>) => fn()
};
