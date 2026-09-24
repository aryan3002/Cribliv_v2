import type { DatabaseService } from "../common/database.service";
import { logTelemetry } from "../common/telemetry";
import { AzureSasIssuer } from "../modules/rent-agreement/downloads/azure-sas-issuer";
import { DevApiSasIssuer } from "../modules/rent-agreement/downloads/dev-api-sas-issuer";
import type { SasIssuerPort } from "../modules/rent-agreement/downloads/sas-issuer.port";
import { AzurePdfStorage } from "../modules/rent-agreement/pdf/azure-pdf-storage";
import {
  buildAzureConnectionString,
  readAzureStorageConfig
} from "../modules/rent-agreement/pdf/azure-storage-config";
import { InMemoryPdfStorage } from "../modules/rent-agreement/pdf/in-memory-pdf-storage";
import type { PdfStoragePort } from "../modules/rent-agreement/pdf/pdf-storage.port";
import { computeLateFee } from "../modules/pg-rent/pure/rent-late-fee";
import { receiptContainer } from "../modules/pg-rent/receipt/receipt-container";
import { LazyReceiptRenderer } from "../modules/pg-rent/receipt/receipt-renderer";
import { RentAllocationService } from "../modules/pg-rent/services/rent-allocation.service";
import { applyFeeDecision, loadFeeContext } from "../modules/pg-rent/services/rent-fee-line";
import { SYSTEM_ACTOR } from "../modules/pg-rent/services/rent-guards";
import { RentInvoiceEngineService } from "../modules/pg-rent/services/rent-invoice-engine.service";
import { RentReceiptService } from "../modules/pg-rent/services/rent-receipt.service";
import { RentSettingsService } from "../modules/pg-rent/services/rent-settings.service";
import { transaction } from "../common/transaction";

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

/**
 * Spec §5.6, same hourly run as generation. Candidate = issued/partially_paid rent
 * invoice, eligible, unwaived, property policy on and not paused, tenant not
 * exempt, no pending claim, past due + grace. Each invoice is its own transaction.
 */
export async function runPgRentLateFeeSweep(
  db: DatabaseService,
  today: string,
  alloc: RentAllocationService = new RentAllocationService()
): Promise<{
  invoices: number;
  applied: number;
  suggested: number;
  updated: number;
  frozen: number;
}> {
  const out = { invoices: 0, applied: 0, suggested: 0, updated: 0, frozen: 0 };
  if (!db.isEnabled()) return out;
  const candidates = await db.query<{ id: string; property_id: string; auto_apply: boolean }>(
    `SELECT i.id::text, i.pg_property_id::text AS property_id, s.late_fee_auto_apply AS auto_apply
       FROM pg_rent_invoices i
       JOIN pg_rent_settings s ON s.pg_property_id = i.pg_property_id
       JOIN pg_bed_assignments a ON a.id = i.assignment_id
      WHERE i.kind = 'rent' AND i.status IN ('issued','partially_paid') AND i.late_fee_eligible AND i.late_fee_waived_at IS NULL
        -- Important 5: the automated sweep never touches a backfilled (retroactively
        -- entered) invoice, even if an operator later flips setEligibility back on —
        -- only the manual, audited applyFee path may charge a fee there.
        AND i.source <> 'backfill'
        AND s.late_fee_enabled AND s.paused_at IS NULL AND NOT a.late_fee_exempt
        AND (i.due_date + s.late_fee_grace_days) < $1::date
        AND NOT EXISTS (SELECT 1 FROM pg_rent_payments p WHERE p.claimed_invoice_id = i.id AND p.status = 'pending_confirmation')
      ORDER BY i.due_date`,
    [today]
  );
  for (const c of candidates.rows) {
    out.invoices += 1;
    try {
      await transaction(db, async (client) => {
        // Critical 1: restore the documented lock order (pg-rent-payment.service.ts's
        // header: pg_properties → ... → pg_rent_invoices). Every operator-facing
        // transaction takes `assertManagedOwnership(..., true)` — a `FOR UPDATE` on
        // pg_properties — as its FIRST statement before ever touching an invoice. An
        // UPDATE on pg_rent_invoices takes an implicit FK `FOR KEY SHARE` on its
        // parent pg_properties row; without taking that lock first ourselves, this
        // sweep's effective order is invoices → properties, the exact reverse of
        // every operator path, and deadlocks against it under concurrent load. Share
        // (not update) so concurrent sweep invocations don't serialise on the
        // property themselves.
        await client.query(`SELECT 1 FROM pg_properties WHERE id = $1::uuid FOR KEY SHARE`, [
          c.property_id
        ]);
        const ctx = await loadFeeContext(client, c.id);
        // Important 4: the candidate list was materialised in one shot, outside any
        // transaction, then iterated one transaction per invoice — the snapshot is
        // stale for the whole run. Re-validate everything the candidate query
        // filtered on, now that we hold the row lock, exactly like
        // RentPaymentService.finalizeConfirmed's own re-check after loadFeeContext:
        // an operator who waives a fee, flips eligibility, or fully settles/cancels
        // the invoice mid-sweep must not be silently overridden (invariant 16).
        // Fix round 2: the round-1 re-check missed two of the candidate
        // query's own WHERE-clause conditions — s.paused_at IS NULL and
        // NOT EXISTS(... pending_confirmation) — leaving both overridable
        // from the stale snapshot too (an operator pausing the property, or
        // a tenant filing a claim, mid-run). Completed here.
        if (
          !ctx.policy ||
          ctx.invoice.kind !== "rent" ||
          !ctx.invoice.eligible ||
          ctx.invoice.exempt ||
          ctx.invoice.waivedAt ||
          !["issued", "partially_paid"].includes(ctx.invoice.status) ||
          ctx.paused ||
          ctx.hasPendingClaim
        )
          return;
        const chargeable = ctx.invoice.totalPaise - ctx.invoice.paidPaise - (ctx.feeLinePaise ?? 0);
        const decision = computeLateFee({
          policy: ctx.policy,
          dueDate: ctx.invoice.dueDate,
          asOf: today,
          chargeablePaise: chargeable,
          overridePaise: ctx.invoice.overridePaise,
          existingFeePaise: ctx.feeLinePaise ?? ctx.invoice.suggestedPaise,
          // Correction 1 (task-6 brief): scope "frozen" to flat/percent/override
          // already computed. Every path that creates a fee line stamps
          // late_fee_computed_at (rent-fee-line.ts), including per_day ones, so
          // gating solely on computedAt !== null would freeze a per_day fee
          // after its very first application — the whole point of the sweep is
          // to keep re-evaluating per_day as more days pass.
          frozen:
            ctx.invoice.computedAt !== null &&
            (ctx.policy.kind !== "per_day" || ctx.invoice.overridePaise !== null)
        });
        // an existing suggestion that changes amount is re-suggested, never auto-applied.
        // Fix 2 (final fix wave): this used to be handled by a raw UPDATE
        // here that returned before calling applyFeeDecision — the everyday
        // path for every suggest-mode property from day 2 of a per_day fee
        // onward, and it wrote no writeRentEvent (invariant 8 violation).
        // applyFeeDecision's own `opts.applyMode === "suggest" && ctx.feeLinePaise
        // === null` branch (rent-fee-line.ts:190-197) already handles this
        // identical case — decision.action is "apply" or "update", it
        // doesn't branch on which — and writes the late_fee.suggested event,
        // so deleting the early return here is enough; nothing else changes.
        const mode = c.auto_apply ? "line" : "suggest";
        await applyFeeDecision(client, alloc, ctx, decision, SYSTEM_ACTOR, {
          applyMode: mode,
          reason: "late_fee_sweep",
          // Correction 2 (task-6 brief): the sweep never has a payment's
          // paid_on to draw on, so — like waiveFee/applyFee/extendDueDate in
          // rent-invoice.service.ts — it always passes today's date. Without
          // this, a fee decision that closes the invoice's balance to zero
          // (deallocateExcess's unstamped recomputeInvoice call inside
          // applyFeeDecision) would leave the invoice `paid` with a NULL
          // settled_on (spec §4.4 violation).
          settledOn: today
        });
        if (decision.action === "apply") {
          if (mode === "line") out.applied += 1;
          else out.suggested += 1;
        } else if (decision.action === "update") {
          // Fix 2: in suggest mode this is now the re-suggestion path above
          // (applyFeeDecision's suggest branch), not a line amount update.
          if (mode === "suggest") out.suggested += 1;
          else out.updated += 1;
        } else if (decision.action === "freeze") out.frozen += 1;
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          job: "pg_rent_late_fee_sweep",
          invoice_id: c.id,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString()
        })
      );
    }
  }
  logTelemetry("pg_rent.late_fee_sweep", out);
  return out;
}

/** Duplicates pg-rent.module.ts's two storage/SAS factories — the worker has no Nest container. */
function storageFromEnv(): PdfStoragePort {
  const azure = readAzureStorageConfig();
  return azure.present
    ? new AzurePdfStorage({
        connectionString: buildAzureConnectionString(azure.accountName, azure.accountKey),
        containerName: receiptContainer()
      })
    : new InMemoryPdfStorage();
}

function sasFromEnv(): SasIssuerPort {
  const azure = readAzureStorageConfig();
  return azure.present
    ? new AzureSasIssuer({
        accountName: azure.accountName,
        accountKey: azure.accountKey,
        containerName: receiptContainer()
      })
    : new DevApiSasIssuer({ baseUrl: process.env.RENT_AGREEMENT_DEV_BASE_URL ?? "" });
}

// Critical 2: LazyReceiptRenderer launches a real Chromium via BrowserPool on its
// first render() and exposes no dispose method (mirroring
// rent-agreement/pdf/lazy-puppeteer-renderer.ts, which is wired as a Nest
// singleton for exactly this reason — one browser for the process's lifetime).
// worker.ts calls runPgRentReceiptSweep on a 2-minute setInterval with no
// `service` argument; constructing `new RentReceiptService(db, new
// LazyReceiptRenderer(), ...)` fresh on every call would launch (and never
// close) a new Chromium process on every tick that renders at least one
// receipt — an orphaned browser roughly every 2 minutes indefinitely. Memoise
// the default service at module scope so the worker process launches Chromium
// at most once, matching the API's own Nest-DI-cached singleton lifetime.
let defaultReceiptService: RentReceiptService | null = null;
// Exported (not just used internally) so Critical 2's fix — memoisation, so
// the worker's 2-minute tick never launches a second Chromium — has direct,
// cheap covering evidence: see rent-receipt-service-memo.test.ts.
export function receiptServiceFromEnv(db: DatabaseService): RentReceiptService {
  if (!defaultReceiptService)
    defaultReceiptService = new RentReceiptService(
      db,
      new LazyReceiptRenderer(),
      storageFromEnv(),
      sasFromEnv()
    );
  return defaultReceiptService;
}

/** The 2-minute receipt-rendering sweep (spec §6.7): drains the SKIP LOCKED queue. */
export async function runPgRentReceiptSweep(
  db: DatabaseService,
  service?: RentReceiptService
): Promise<{ rendered: number; failed: number }> {
  if (!db.isEnabled()) return { rendered: 0, failed: 0 };
  return (service ?? receiptServiceFromEnv(db)).renderPending();
}
