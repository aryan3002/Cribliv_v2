// Maps `RentAgreementRow` (app shape) <-> a Postgres `rent_agreements` row.
//
// RentAgreementRow keys are identical to the DB column names, so the mapper is
// column-name driven. Column order matches infra/migrations/0024_rent_agreement_v2.sql.
//
// pg already parses jsonb -> object, text[] -> array, bytea -> Buffer, and
// timestamptz/date -> Date. The remaining work:
//   • write path: jsonb columns must be JSON.stringify'd (a JS array handed to a
//     jsonb param would otherwise be encoded as a Postgres array literal).
//   • read path: Date -> ISO string, numeric -> number, jsonb defaults.

import type { RentAgreementRow } from "./draft-summary.mapper";

export const RENT_AGREEMENT_COLUMNS: ReadonlyArray<keyof RentAgreementRow> = [
  "id",
  "user_id",
  "plan_id",
  "locale",
  "idempotency_key",
  "current_step",
  "step_validated_at",
  "status",
  "owner_full_name",
  "owner_father_name",
  "owner_age",
  "owner_phone",
  "owner_email",
  "owner_permanent_address",
  "owner_pan_ct",
  "owner_aadhaar_last4",
  "tenant_full_name",
  "tenant_father_name",
  "tenant_age",
  "tenant_phone",
  "tenant_email",
  "tenant_permanent_address",
  "tenant_pan_ct",
  "tenant_aadhaar_last4",
  "tenant_company_name",
  "property_full_address",
  "property_type",
  "property_area_sqft",
  "property_furnishing",
  "property_purpose",
  "property_parking",
  "property_floor_number",
  "property_total_floors",
  "property_flat_number",
  "property_municipal_number",
  "property_survey_number",
  "agreement_type",
  "agreement_date",
  "commencement_date",
  "tenure_months",
  "lock_in_months",
  "notice_period_months",
  "rent_amount_paise",
  "security_deposit_paise",
  "annual_increment_pct",
  "state_code",
  "city",
  "acknowledge_registration_required",
  "inventory_items",
  "rent_due_day",
  "rent_payment_method",
  "maintenance_included",
  "maintenance_paise",
  "electricity_allocation",
  "water_allocation",
  "gas_allocation",
  "society_charges_allocation",
  "late_payment_penalty_pct",
  "pets_allowed",
  "subletting_allowed",
  "renovation_allowed",
  "commercial_use_allowed",
  "max_occupants",
  "additional_terms",
  "witness_1",
  "witness_2",
  "stamp_duty_paise",
  "payment_order_id",
  "pdf_blob_path",
  "pdf_generated_at",
  "download_count",
  "max_downloads",
  "expires_at",
  "e_stamp_reference",
  "e_sign_session_id",
  "e_sign_completed_at",
  "created_at",
  "updated_at"
];

// jsonb columns — must be explicitly serialised on the write path.
const JSON_COLUMNS: ReadonlySet<string> = new Set([
  "step_validated_at",
  "inventory_items",
  "witness_1",
  "witness_2"
]);

// `date` columns — formatted YYYY-MM-DD on the read path.
const DATE_ONLY_COLUMNS: ReadonlySet<string> = new Set(["agreement_date", "commencement_date"]);

// `timestamptz` columns — formatted as ISO strings on the read path.
const TIMESTAMP_COLUMNS: ReadonlySet<string> = new Set([
  "pdf_generated_at",
  "expires_at",
  "e_sign_completed_at",
  "created_at",
  "updated_at"
]);

// `numeric` columns — pg returns these as strings; coerce to number.
const NUMERIC_COLUMNS: ReadonlySet<string> = new Set([
  "annual_increment_pct",
  "late_payment_penalty_pct"
]);

export interface ColumnBinding {
  columns: string[];
  values: unknown[];
}

/** App row -> ordered (columns, values) suitable for an INSERT/UPDATE. */
export function appRowToColumns(row: RentAgreementRow): ColumnBinding {
  const columns: string[] = [];
  const values: unknown[] = [];
  for (const col of RENT_AGREEMENT_COLUMNS) {
    columns.push(col);
    const value = row[col];
    if (JSON_COLUMNS.has(col)) {
      values.push(value == null ? null : JSON.stringify(value));
    } else {
      values.push(value ?? null);
    }
  }
  return { columns, values };
}

function toIsoString(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function toDateOnly(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

/** Postgres row -> app `RentAgreementRow`. */
export function dbRowToAppRow(dbRow: Record<string, unknown>): RentAgreementRow {
  const out: Record<string, unknown> = {};
  for (const col of RENT_AGREEMENT_COLUMNS) {
    const raw = dbRow[col];
    if (DATE_ONLY_COLUMNS.has(col)) {
      out[col] = toDateOnly(raw);
    } else if (TIMESTAMP_COLUMNS.has(col)) {
      out[col] = toIsoString(raw);
    } else if (NUMERIC_COLUMNS.has(col)) {
      out[col] = raw == null ? null : Number(raw);
    } else {
      out[col] = raw ?? null;
    }
  }
  // NOT NULL columns with collection / scalar defaults.
  out.step_validated_at = dbRow.step_validated_at ?? {};
  out.inventory_items = dbRow.inventory_items ?? [];
  out.additional_terms = dbRow.additional_terms ?? [];
  out.acknowledge_registration_required = Boolean(dbRow.acknowledge_registration_required);
  out.stamp_duty_paise = Number(dbRow.stamp_duty_paise ?? 0);
  out.download_count = Number(dbRow.download_count ?? 0);
  out.max_downloads = Number(dbRow.max_downloads ?? 5);
  out.current_step = Number(dbRow.current_step);
  return out as unknown as RentAgreementRow;
}
