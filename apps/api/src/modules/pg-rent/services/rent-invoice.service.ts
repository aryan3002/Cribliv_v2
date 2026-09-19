import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  PgRentEvent,
  PgRentInvoice,
  PgRentInvoiceListFilters,
  PgRentTenantOverridesInput
} from "@cribliv/shared-types";

import { DatabaseService } from "../../../common/database.service";
import { transaction } from "../../../common/transaction";
import {
  INVOICE_SELECT,
  LINE_SELECT,
  toEventDto,
  toInvoiceDto,
  type RentEventRow,
  type RentInvoiceRow,
  type RentLineRow
} from "../dto/invoice.dto";
import { inrToPaise } from "../dto/money";
import { writeRentEvent } from "./rent-events";
import { assertManagedOwnership, requireDb, type Queryable } from "./rent-guards";

@Injectable()
export class RentInvoiceService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async list(
    operatorId: string,
    propertyId: string,
    filters: PgRentInvoiceListFilters
  ): Promise<PgRentInvoice[]> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    const where: string[] = ["i.pg_property_id = $1::uuid"];
    const params: unknown[] = [propertyId];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace("?", `$${params.length}`));
    };
    if (filters.status) add("i.status = ?::pg_rent_invoice_status", filters.status);
    if (filters.kind) add("i.kind = ?::pg_rent_invoice_kind", filters.kind);
    if (filters.assignment_id) add("i.assignment_id = ?::uuid", filters.assignment_id);
    if (filters.billing_month) add("i.billing_month = ?::date", filters.billing_month);
    const rows = await this.db.query<RentInvoiceRow>(
      `SELECT ${INVOICE_SELECT} FROM pg_rent_invoices i JOIN pg_bed_assignments a ON a.id = i.assignment_id
        WHERE ${where.join(" AND ")} ORDER BY i.due_date DESC, i.created_at DESC LIMIT 500`,
      params
    );
    return this.withLines(this.db, rows.rows);
  }

  async get(operatorId: string, propertyId: string, invoiceId: string): Promise<PgRentInvoice> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    const rows = await this.db.query<RentInvoiceRow>(
      `SELECT ${INVOICE_SELECT} FROM pg_rent_invoices i JOIN pg_bed_assignments a ON a.id = i.assignment_id
        WHERE i.id = $1::uuid AND i.pg_property_id = $2::uuid`,
      [invoiceId, propertyId]
    );
    if (!rows.rows[0]) throw new NotFoundException({ code: "invoice_not_found" });
    return (await this.withLines(this.db, rows.rows))[0];
  }

  async events(operatorId: string, propertyId: string, invoiceId: string): Promise<PgRentEvent[]> {
    await this.get(operatorId, propertyId, invoiceId);
    const rows = await this.db.query<RentEventRow>(
      `SELECT id::text, entity_type, entity_id::text, event_type, actor_user_id::text, actor_role, payload, created_at
         FROM pg_rent_events WHERE entity_type = 'invoice' AND entity_id = $1::uuid ORDER BY id`,
      [invoiceId]
    );
    return rows.rows.map(toEventDto);
  }

  /** Spec §11 "Tenant overrides" + §5.7 "Change rent from next cycle" + §5.2 move-in while null. */
  async updateTenantOverrides(
    operatorId: string,
    propertyId: string,
    assignmentId: string,
    input: PgRentTenantOverridesInput
  ): Promise<void> {
    requireDb(this.db);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const current = await client.query<{
        move_in_date: Date | null;
        monthly_rent_paise: string | null;
      }>(
        `SELECT move_in_date, monthly_rent_paise::text FROM pg_bed_assignments
          WHERE id = $1::uuid AND pg_property_id = $2::uuid FOR UPDATE`,
        [assignmentId, propertyId]
      );
      if (!current.rows[0]) throw new NotFoundException({ code: "assignment_not_found" });
      const actor = { id: operatorId, role: "pg_operator" as const };

      if (input.monthly_rent_inr !== undefined) {
        const to = inrToPaise(input.monthly_rent_inr);
        await client.query(
          `UPDATE pg_bed_assignments SET monthly_rent_paise = $2 WHERE id = $1::uuid`,
          [assignmentId, to]
        );
        await writeRentEvent(client, {
          propertyId,
          entityType: "assignment",
          entityId: assignmentId,
          eventType: "rent.changed",
          actor,
          payload: {
            from_paise:
              current.rows[0].monthly_rent_paise === null
                ? null
                : Number(current.rows[0].monthly_rent_paise),
            to_paise: to
          }
        });
      }
      if (input.move_in_date !== undefined) {
        if (current.rows[0].move_in_date !== null)
          throw new ConflictException({ code: "move_in_already_set" });
        await client.query(
          `UPDATE pg_bed_assignments SET move_in_date = $2::date WHERE id = $1::uuid`,
          [assignmentId, input.move_in_date]
        );
        await writeRentEvent(client, {
          propertyId,
          entityType: "assignment",
          entityId: assignmentId,
          eventType: "assignment.move_in_date_set",
          actor,
          payload: { move_in_date: input.move_in_date }
        });
      }
      const overrides: Record<string, unknown> = {};
      if (input.rent_due_day !== undefined) overrides.rent_due_day = input.rent_due_day;
      if (input.late_fee_exempt !== undefined) overrides.late_fee_exempt = input.late_fee_exempt;
      if (input.late_fee_override_inr !== undefined) {
        overrides.late_fee_override_paise =
          input.late_fee_override_inr === null ? null : inrToPaise(input.late_fee_override_inr);
      }
      if (input.default_item_excludes !== undefined) {
        overrides.default_item_overrides = JSON.stringify({ exclude: input.default_item_excludes });
      }
      if (Object.keys(overrides).length) {
        const names = Object.keys(overrides);
        const sets = names
          .map((n, i) => `${n} = $${i + 2}${n === "default_item_overrides" ? "::jsonb" : ""}`)
          .join(", ");
        await client.query(`UPDATE pg_bed_assignments SET ${sets} WHERE id = $1::uuid`, [
          assignmentId,
          ...Object.values(overrides)
        ]);
        await writeRentEvent(client, {
          propertyId,
          entityType: "assignment",
          entityId: assignmentId,
          eventType: "assignment.override_updated",
          actor,
          payload: overrides
        });
      }
    });
  }

  private async withLines(q: Queryable, rows: RentInvoiceRow[]): Promise<PgRentInvoice[]> {
    if (rows.length === 0) return [];
    const lines = await q.query<RentLineRow>(
      `SELECT ${LINE_SELECT} FROM pg_rent_invoice_lines l WHERE l.invoice_id = ANY($1::uuid[])`,
      [rows.map((r) => r.id)]
    );
    return rows.map((r) => toInvoiceDto(r, lines.rows));
  }
}
