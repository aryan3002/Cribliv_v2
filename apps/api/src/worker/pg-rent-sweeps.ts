import type { DatabaseService } from "../common/database.service";
import { logTelemetry } from "../common/telemetry";
import { RentAllocationService } from "../modules/pg-rent/services/rent-allocation.service";
import { RentInvoiceEngineService } from "../modules/pg-rent/services/rent-invoice-engine.service";
import { SYSTEM_ACTOR } from "../modules/pg-rent/services/rent-guards";
import { RentSettingsService } from "../modules/pg-rent/services/rent-settings.service";

type Engine = Pick<RentInvoiceEngineService, "generateInvoicesForProperty">;

export interface PgRentSweepResult {
  properties: number;
  invoices: number;
  drafts: number;
  deposits: number;
}

/**
 * Hourly (spec §5.1). One property failing is logged and skipped; the rest
 * still run. Each invoice is its own transaction inside the engine.
 */
export async function runPgRentSweep(
  db: DatabaseService,
  today: string,
  engine: Engine = new RentInvoiceEngineService(
    db,
    new RentSettingsService(db),
    new RentAllocationService()
  )
): Promise<PgRentSweepResult> {
  const result: PgRentSweepResult = { properties: 0, invoices: 0, drafts: 0, deposits: 0 };
  if (!db.isEnabled()) return result;
  const started = Date.now();
  const properties = await db.query<{ pg_property_id: string }>(
    `SELECT pg_property_id::text FROM pg_rent_settings WHERE paused_at IS NULL ORDER BY pg_property_id`,
    []
  );
  for (const row of properties.rows) {
    result.properties += 1;
    try {
      const r = await engine.generateInvoicesForProperty(row.pg_property_id, today, SYSTEM_ACTOR);
      result.invoices += r.invoices_created;
      result.drafts += r.drafts_created;
      result.deposits += r.deposits_created;
    } catch (error) {
      console.error(
        JSON.stringify({
          job: "pg_rent_sweep",
          pg_property_id: row.pg_property_id,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString()
        })
      );
    }
  }
  logTelemetry("pg_rent.sweep_run", { ...result, ms: Date.now() - started });
  return result;
}
