import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type {
  PgRentEnableInput,
  PgRentPatchSettingsInput,
  PgRentResumeInput,
  PgRentSettings
} from "@cribliv/shared-types";

import { DatabaseService } from "../../../common/database.service";
import { todayIst } from "../../../common/date";
import { transaction } from "../../../common/transaction";
import { settingsInputToColumns, toSettingsDto, type RentSettingsRow } from "../dto/settings.dto";
import { writeRentEvent } from "./rent-events";
import { assertManagedOwnership, requireDb, type Queryable, type RentActor } from "./rent-guards";

const SETTINGS_COLUMNS = `
  pg_property_id::text, paused_at, pause_reason::text, enabled_on, billing_starts_on,
  cycle_mode::text, billing_timing::text, due_day, proration_mode::text, prorate_move_out,
  invoice_lead_days, reminder_offsets_days, late_fee_enabled, late_fee_grace_days, late_fee_kind::text,
  late_fee_amount_paise, late_fee_percent_bp, late_fee_cap_paise, late_fee_auto_apply,
  upi_vpa, upi_payee_name, bank_details, whatsapp_phone_e164,
  msg_reminder, msg_overdue, msg_tenant_paid, msg_receipt_share,
  receipt_prefix, receipt_business_name, receipt_address, receipt_footer, receipt_logo_path,
  default_line_items, electricity_unit_rate_paise, created_at, updated_at`;

const PAYEE_COLUMNS = ["upi_vpa", "upi_payee_name", "bank_details", "whatsapp_phone_e164"] as const;

/** 2–6 capitals/digits from internal_code, else initials of the display name, else "PG". */
export function deriveReceiptPrefix(internalCode: string | null, displayName: string): string {
  const fromCode = (internalCode ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
  if (fromCode.length >= 2) return fromCode;
  const initials = displayName
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, "")[0])
    .filter(Boolean)
    .join("")
    .toUpperCase()
    .slice(0, 6);
  if (initials.length >= 2) return initials;
  return (initials + "PG").slice(0, 6);
}

@Injectable()
export class RentSettingsService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  private actor(operatorId: string): RentActor {
    return { id: operatorId, role: "pg_operator" };
  }

  /** Internal read with no ownership check (engine, hooks). */
  async getRow(q: Queryable, propertyId: string, lock = false): Promise<RentSettingsRow | null> {
    const result = await q.query<RentSettingsRow>(
      `SELECT ${SETTINGS_COLUMNS} FROM pg_rent_settings WHERE pg_property_id = $1::uuid${lock ? " FOR UPDATE" : ""}`,
      [propertyId]
    );
    return result.rows[0] ?? null;
  }

  async defaultsFor(
    q: Queryable,
    propertyId: string
  ): Promise<{ due_day: number; receipt_prefix: string }> {
    const property = await q.query<{ internal_code: string | null; display_name: string }>(
      `SELECT internal_code, display_name FROM pg_properties WHERE id = $1::uuid`,
      [propertyId]
    );
    const details = await q.query<{ rent_due_day: number | null }>(
      `SELECT d.rent_due_day
         FROM pg_listings pl JOIN pg_details d ON d.listing_id = pl.id
        WHERE pl.pg_property_id = $1::uuid AND d.rent_due_day IS NOT NULL
        ORDER BY pl.created_at ASC LIMIT 1`,
      [propertyId]
    );
    return {
      due_day: details.rows[0]?.rent_due_day ?? 1,
      receipt_prefix: deriveReceiptPrefix(
        property.rows[0]?.internal_code ?? null,
        property.rows[0]?.display_name ?? "PG"
      )
    };
  }

  async enable(
    operatorId: string,
    propertyId: string,
    input: PgRentEnableInput
  ): Promise<PgRentSettings> {
    requireDb(this.db);
    return transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      if (await this.getRow(client, propertyId, true)) {
        throw new ConflictException({
          code: "already_enabled",
          message: "Rent collection is already enabled"
        });
      }
      const defaults = await this.defaultsFor(client, propertyId);
      const { billing_starts_on, ...rest } = input;
      const cols = {
        due_day: defaults.due_day,
        receipt_prefix: defaults.receipt_prefix,
        ...settingsInputToColumns(rest),
        pg_property_id: propertyId,
        enabled_on: todayIst(),
        billing_starts_on: billing_starts_on ?? todayIst()
      };
      const names = Object.keys(cols);
      const values = Object.values(cols);
      const placeholders = names.map((name, i) => this.cast(name, `$${i + 1}`)).join(", ");
      const inserted = await client.query<RentSettingsRow>(
        `INSERT INTO pg_rent_settings (${names.join(", ")}) VALUES (${placeholders}) RETURNING ${SETTINGS_COLUMNS}`,
        values
      );
      await client.query(`INSERT INTO pg_rent_counters (pg_property_id) VALUES ($1::uuid)`, [
        propertyId
      ]);
      await writeRentEvent(client, {
        propertyId,
        entityType: "settings",
        entityId: propertyId,
        eventType: "settings.enabled",
        actor: this.actor(operatorId),
        payload: { billing_starts_on: cols.billing_starts_on }
      });
      return toSettingsDto(inserted.rows[0]);
    });
  }

  async get(operatorId: string, propertyId: string): Promise<PgRentSettings | null> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    const row = await this.getRow(this.db, propertyId);
    return row ? toSettingsDto(row) : null;
  }

  async patch(
    operatorId: string,
    propertyId: string,
    input: PgRentPatchSettingsInput
  ): Promise<PgRentSettings> {
    requireDb(this.db);
    return transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const current = await this.requireRow(client, propertyId, true);
      if (new Date(current.updated_at).toISOString() !== new Date(input.updated_at).toISOString()) {
        throw new ConflictException({
          code: "settings_conflict",
          message: "Settings changed since you loaded them"
        });
      }
      const { updated_at: _token, ...rest } = input;
      const cols = settingsInputToColumns(rest);
      if (Object.keys(cols).length === 0) return toSettingsDto(current);
      const updated = await this.applyColumns(client, propertyId, cols);
      await writeRentEvent(client, {
        propertyId,
        entityType: "settings",
        entityId: propertyId,
        eventType: "settings.updated",
        actor: this.actor(operatorId),
        payload: { diff: this.diff(current, updated) }
      });
      return toSettingsDto(updated);
    });
  }

  async pause(operatorId: string, propertyId: string): Promise<PgRentSettings> {
    requireDb(this.db);
    return transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      await this.requireRow(client, propertyId, true);
      const updated = await client.query<RentSettingsRow>(
        `UPDATE pg_rent_settings SET paused_at = COALESCE(paused_at, now()), pause_reason = COALESCE(pause_reason, 'owner')
          WHERE pg_property_id = $1::uuid RETURNING ${SETTINGS_COLUMNS}`,
        [propertyId]
      );
      await writeRentEvent(client, {
        propertyId,
        entityType: "settings",
        entityId: propertyId,
        eventType: "settings.paused",
        actor: this.actor(operatorId)
      });
      return toSettingsDto(updated.rows[0]);
    });
  }

  async resume(
    operatorId: string,
    propertyId: string,
    input: PgRentResumeInput
  ): Promise<PgRentSettings> {
    requireDb(this.db);
    return transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const current = await this.requireRow(client, propertyId, true);
      if (current.pause_reason === "transfer" && !current.upi_vpa && !current.bank_details) {
        throw new ConflictException({
          code: "payee_required",
          message: "Add a UPI ID or bank details before resuming after an ownership transfer"
        });
      }
      const floor = input.billing_starts_on ?? todayIst();
      const updated = await client.query<RentSettingsRow>(
        `UPDATE pg_rent_settings SET paused_at = NULL, pause_reason = NULL, billing_starts_on = $2::date
          WHERE pg_property_id = $1::uuid RETURNING ${SETTINGS_COLUMNS}`,
        [propertyId, floor]
      );
      await writeRentEvent(client, {
        propertyId,
        entityType: "settings",
        entityId: propertyId,
        eventType: "settings.resumed",
        actor: this.actor(operatorId),
        payload: { billing_starts_on: floor }
      });
      return toSettingsDto(updated.rows[0]);
    });
  }

  /**
   * Spec §11.2 / D20. Runs INSIDE AdminPgTransferService's transaction, after
   * operator_id is re-pointed. Data-driven: no settings row → nothing happens.
   */
  async onOwnershipTransferred(
    client: PoolClient,
    propertyId: string,
    fromOperatorId: string,
    toOperatorId: string
  ): Promise<void> {
    const current = await this.getRow(client, propertyId, true);
    if (!current) return;
    await client.query(
      `UPDATE pg_rent_settings
          SET paused_at = COALESCE(paused_at, now()), pause_reason = 'transfer',
              upi_vpa = NULL, upi_payee_name = NULL, bank_details = NULL, whatsapp_phone_e164 = NULL
        WHERE pg_property_id = $1::uuid`,
      [propertyId]
    );
    await writeRentEvent(client, {
      propertyId,
      entityType: "settings",
      entityId: propertyId,
      eventType: "settings.transferred",
      actor: { id: null, role: "admin" },
      payload: {
        from_operator: fromOperatorId,
        to_operator: toOperatorId,
        cleared: [...PAYEE_COLUMNS]
      }
    });
  }

  private async requireRow(
    q: Queryable,
    propertyId: string,
    lock: boolean
  ): Promise<RentSettingsRow> {
    const row = await this.getRow(q, propertyId, lock);
    if (!row)
      throw new NotFoundException({
        code: "rent_not_enabled",
        message: "Rent collection is not enabled"
      });
    return row;
  }

  private cast(column: string, placeholder: string): string {
    if (column === "bank_details" || column === "default_line_items")
      return `${placeholder}::jsonb`;
    if (column === "reminder_offsets_days") return `${placeholder}::smallint[]`;
    if (column === "pg_property_id") return `${placeholder}::uuid`;
    if (column === "enabled_on" || column === "billing_starts_on") return `${placeholder}::date`;
    if (column === "cycle_mode") return `${placeholder}::pg_rent_cycle_mode`;
    if (column === "billing_timing") return `${placeholder}::pg_rent_billing_timing`;
    if (column === "proration_mode") return `${placeholder}::pg_rent_proration_mode`;
    if (column === "late_fee_kind") return `${placeholder}::pg_rent_late_fee_kind`;
    return placeholder;
  }

  private async applyColumns(
    client: Queryable,
    propertyId: string,
    cols: Record<string, unknown>
  ): Promise<RentSettingsRow> {
    const names = Object.keys(cols);
    const sets = names.map((name, i) => `${name} = ${this.cast(name, `$${i + 2}`)}`).join(", ");
    const updated = await client.query<RentSettingsRow>(
      `UPDATE pg_rent_settings SET ${sets} WHERE pg_property_id = $1::uuid RETURNING ${SETTINGS_COLUMNS}`,
      [propertyId, ...Object.values(cols)]
    );
    return updated.rows[0];
  }

  /** {column: {from, to}} for every column whose serialised value changed. */
  private diff(
    before: RentSettingsRow,
    after: RentSettingsRow
  ): Record<string, { from: unknown; to: unknown }> {
    const out: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(after) as Array<keyof RentSettingsRow>) {
      if (key === "updated_at" || key === "created_at") continue;
      const a = JSON.stringify(this.normalise(before[key]));
      const b = JSON.stringify(this.normalise(after[key]));
      if (a !== b) out[key] = { from: this.normalise(before[key]), to: this.normalise(after[key]) };
    }
    return out;
  }

  private normalise(value: unknown): unknown {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string" && /^\d+$/.test(value)) return Number(value); // bigint columns arrive as strings
    return value;
  }
}
