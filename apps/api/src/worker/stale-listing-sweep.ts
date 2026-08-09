import type { Pool } from "pg";
import { readFeatureFlags } from "../config/feature-flags";

/** A listing is a pause candidate after this long with no owner activity. */
export const STALE_SWEEP_DAYS = 30;

/**
 * Circuit breaker. A run that wants to pause more than this share of active
 * inventory is treated as a bug, not a backlog, and pauses nothing.
 *
 * On 2026-08-09 the uncapped sweep paused effectively the entire catalogue in a
 * single run: `last_owner_activity_at` only advances when an owner edits their
 * own listing (owner.service.ts), so migrated v1 inventory and admin-created
 * homes — whose owners never sign in to v2 — all crossed the 30-day line
 * together. Search went empty and every listing detail page 404'd.
 */
export const STALE_SWEEP_MAX_PAUSE_RATIO = 0.1;

export interface StaleSweepResult {
  /** Listings actually moved to `paused`. */
  paused: number;
  /** Listings matching the staleness predicate before the cap was applied. */
  candidates: number;
  /** Active listings at the time of the run — the cap's denominator. */
  active: number;
  /** Maximum listings this run was willing to pause. */
  cap: number;
  skipped: "flag_off" | "cap_exceeded" | null;
}

type StaleSweepFlags = Pick<ReturnType<typeof readFeatureFlags>, "ff_stale_listing_sweep">;

function emptyResult(skipped: StaleSweepResult["skipped"]): StaleSweepResult {
  return { paused: 0, candidates: 0, active: 0, cap: 0, skipped };
}

/**
 * Auto-pause listings whose owner has been silent for {@link STALE_SWEEP_DAYS}.
 *
 * Ships behind `ff_stale_listing_sweep` (default OFF) and refuses to run when
 * the batch looks like a mass wipe. Callers get a structured result to log;
 * errors propagate so the worker can report them.
 */
export async function runStaleListingSweep(
  pool: Pool,
  flags: StaleSweepFlags = readFeatureFlags()
): Promise<StaleSweepResult> {
  if (!flags.ff_stale_listing_sweep) return emptyResult("flag_off");

  const staleWhere = `status = 'active'
       AND last_owner_activity_at < now() - make_interval(days => ${STALE_SWEEP_DAYS})`;

  const census = await pool.query<{ active_count: number; stale_count: number }>(
    `SELECT count(*)::int AS active_count,
            count(*) FILTER (
              WHERE last_owner_activity_at < now() - make_interval(days => ${STALE_SWEEP_DAYS})
            )::int AS stale_count
       FROM listings
      WHERE status = 'active'`
  );

  const active = census.rows[0]?.active_count ?? 0;
  const candidates = census.rows[0]?.stale_count ?? 0;

  // Floor of 1 so a five-listing catalogue can still retire its one dead entry
  // instead of deadlocking on a cap that rounds to zero.
  const cap = Math.max(1, Math.floor(active * STALE_SWEEP_MAX_PAUSE_RATIO));

  if (candidates === 0) return { paused: 0, candidates, active, cap, skipped: null };
  if (candidates > cap) return { paused: 0, candidates, active, cap, skipped: "cap_exceeded" };

  // The cap is enforced by the statement, not just checked beforehand: the
  // UPDATE re-evaluates the predicate, so without LIMIT a listing crossing the
  // 30-day line between the census and here could push the batch over.
  const result = await pool.query<{ id: string }>(
    `UPDATE listings
        SET status = 'paused', updated_at = now()
      WHERE id IN (
        SELECT id FROM listings
         WHERE ${staleWhere}
         ORDER BY last_owner_activity_at ASC
         LIMIT $1
      )
      RETURNING id::text AS id`,
    [cap]
  );

  for (const row of result.rows) {
    await pool
      .query(
        `INSERT INTO fraud_flags (listing_id, flag_type, severity, details)
         VALUES ($1::uuid, 'stale', 'low', '{"reason":"no_activity_30d"}'::jsonb)`,
        [row.id]
      )
      .catch(() => {});
  }

  return { paused: result.rowCount ?? 0, candidates, active, cap, skipped: null };
}
