import type { DatabaseService } from "../common/database.service";

const AUTO_CLOSE_BATCH_SIZE = 100;

export async function autoCloseResolvedMaintenance(db: DatabaseService): Promise<number> {
  if (!db.isEnabled()) return 0;

  const client = await db.getClient();
  let closedCount = 0;
  try {
    while (true) {
      await client.query("BEGIN");
      const due = await client.query<{ id: string }>(
        `SELECT id::text
           FROM pg_maintenance_requests
          WHERE status = 'resolved'
            AND auto_close_after <= now()
          ORDER BY auto_close_after ASC, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $1`,
        [AUTO_CLOSE_BATCH_SIZE]
      );

      if (!due.rowCount) {
        await client.query("COMMIT");
        break;
      }

      const ids = due.rows.map((row) => row.id);
      const updated = await client.query<{ id: string }>(
        `UPDATE pg_maintenance_requests
            SET status = 'closed',
                closed_at = now(),
                auto_closed_at = now(),
                updated_at = now()
          WHERE id = ANY($1::uuid[])
            AND status = 'resolved'
          RETURNING id::text`,
        [ids]
      );
      if (updated.rowCount) {
        await client.query(
          `INSERT INTO pg_maintenance_events
             (request_id, event_type, visibility, actor_user_id, actor_role,
              from_status, to_status, payload, created_at)
           SELECT id::uuid, 'auto_closed', 'public', NULL, 'system',
                  'resolved', 'closed', '{}'::jsonb, clock_timestamp()
             FROM unnest($1::uuid[]) AS id`,
          [updated.rows.map((row) => row.id)]
        );
      }

      await client.query("COMMIT");
      closedCount += updated.rowCount ?? 0;
      if (due.rowCount < AUTO_CLOSE_BATCH_SIZE) break;
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  return closedCount;
}
