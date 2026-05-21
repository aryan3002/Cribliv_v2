// Per-step DTO → flat row column writers. Inverse of draft-summary.mapper for the write path.
// Kept defensive: only assigns when the source field is explicitly present (so partial autosave
// payloads don't accidentally null out previously-saved data).

import type { PlanId } from "./step-registry";
import type { RentAgreementRow, InventoryItemJson, WitnessJson } from "./draft-summary.mapper";

type AnyRecord = Record<string, unknown>;

function assign<T extends object, K extends keyof T>(
  row: T,
  key: K,
  value: T[K] | undefined
): void {
  if (value !== undefined) row[key] = value;
}

export function blankRow(args: {
  id: string;
  userId: string;
  planId: PlanId;
  locale: "en" | "hi";
  idempotencyKey: string;
  timestamp: string;
}): RentAgreementRow {
  return {
    id: args.id,
    user_id: args.userId,
    plan_id: args.planId,
    locale: args.locale,
    idempotency_key: args.idempotencyKey,
    current_step: 1,
    step_validated_at: {},
    status: "draft",
    owner_full_name: null,
    owner_father_name: null,
    owner_age: null,
    owner_phone: null,
    owner_email: null,
    owner_permanent_address: null,
    owner_pan_ct: null,
    owner_aadhaar_last4: null,
    tenant_full_name: null,
    tenant_father_name: null,
    tenant_age: null,
    tenant_phone: null,
    tenant_email: null,
    tenant_permanent_address: null,
    tenant_pan_ct: null,
    tenant_aadhaar_last4: null,
    tenant_company_name: null,
    property_full_address: null,
    property_type: null,
    property_area_sqft: null,
    property_furnishing: null,
    property_purpose: null,
    property_parking: null,
    property_floor_number: null,
    property_total_floors: null,
    property_flat_number: null,
    property_municipal_number: null,
    property_survey_number: null,
    agreement_type: null,
    agreement_date: null,
    commencement_date: null,
    tenure_months: null,
    lock_in_months: null,
    notice_period_months: null,
    rent_amount_paise: null,
    security_deposit_paise: null,
    annual_increment_pct: null,
    state_code: null,
    city: null,
    acknowledge_registration_required: false,
    inventory_items: [],
    rent_due_day: null,
    rent_payment_method: null,
    maintenance_included: null,
    maintenance_paise: null,
    electricity_allocation: null,
    water_allocation: null,
    gas_allocation: null,
    society_charges_allocation: null,
    late_payment_penalty_pct: null,
    pets_allowed: null,
    subletting_allowed: null,
    renovation_allowed: null,
    commercial_use_allowed: null,
    max_occupants: null,
    additional_terms: [],
    witness_1: null,
    witness_2: null,
    stamp_duty_paise: 0,
    payment_order_id: null,
    pdf_blob_path: null,
    pdf_generated_at: null,
    download_count: 0,
    max_downloads: 5,
    expires_at: null,
    e_stamp_reference: null,
    e_sign_session_id: null,
    e_sign_completed_at: null,
    created_at: args.timestamp,
    updated_at: args.timestamp
  };
}

function writeParty(
  row: RentAgreementRow,
  party: "owner" | "tenant",
  p: AnyRecord,
  encryptPan: (s: string) => Buffer
): void {
  const prefix = party;
  assign(row, `${prefix}_full_name` as keyof RentAgreementRow, p.full_name as never);
  assign(row, `${prefix}_father_name` as keyof RentAgreementRow, p.father_name as never);
  assign(row, `${prefix}_age` as keyof RentAgreementRow, p.age as never);
  assign(row, `${prefix}_phone` as keyof RentAgreementRow, p.phone as never);
  assign(row, `${prefix}_email` as keyof RentAgreementRow, p.email as never);
  assign(
    row,
    `${prefix}_permanent_address` as keyof RentAgreementRow,
    p.permanent_address as never
  );
  assign(row, `${prefix}_aadhaar_last4` as keyof RentAgreementRow, p.aadhaar_last4 as never);
  if (p.pan != null && typeof p.pan === "string") {
    if (party === "owner") row.owner_pan_ct = encryptPan(p.pan);
    else row.tenant_pan_ct = encryptPan(p.pan);
  }
}

export function writeStep1(
  row: RentAgreementRow,
  payload: AnyRecord,
  encryptPan: (s: string) => Buffer
): void {
  if (payload.owner && typeof payload.owner === "object") {
    writeParty(row, "owner", payload.owner as AnyRecord, encryptPan);
  }
  if (payload.tenant && typeof payload.tenant === "object") {
    writeParty(row, "tenant", payload.tenant as AnyRecord, encryptPan);
    assign(row, "tenant_company_name", (payload.tenant as AnyRecord).tenant_company_name as never);
  }
}

export function writeStep2(row: RentAgreementRow, p: AnyRecord): void {
  assign(row, "property_full_address", p.full_address as never);
  assign(row, "property_type", p.type as never);
  assign(row, "property_area_sqft", p.area_sqft as never);
  assign(row, "property_furnishing", p.furnishing as never);
  assign(row, "property_purpose", p.purpose as never);
  assign(row, "property_parking", p.parking as never);
  assign(row, "property_floor_number", p.floor_number as never);
  assign(row, "property_total_floors", p.total_floors as never);
  assign(row, "property_flat_number", p.flat_number as never);
  assign(row, "property_municipal_number", p.municipal_number as never);
  assign(row, "property_survey_number", p.survey_number as never);
}

export function writeStep3(row: RentAgreementRow, p: AnyRecord): void {
  assign(row, "agreement_type", p.agreement_type as never);
  assign(row, "agreement_date", p.agreement_date as never);
  assign(row, "commencement_date", p.commencement_date as never);
  assign(row, "tenure_months", p.tenure_months as never);
  assign(row, "lock_in_months", p.lock_in_months as never);
  assign(row, "notice_period_months", p.notice_period_months as never);
  assign(row, "rent_amount_paise", p.rent_amount_paise as never);
  assign(row, "security_deposit_paise", p.security_deposit_paise as never);
  assign(row, "annual_increment_pct", p.annual_increment_pct as never);
  assign(row, "state_code", p.state_code as never);
  assign(row, "city", p.city as never);
  if (typeof p.acknowledge_registration_required === "boolean") {
    row.acknowledge_registration_required = p.acknowledge_registration_required;
  }
}

export function writeStep4(row: RentAgreementRow, p: AnyRecord): void {
  if (Array.isArray(p.inventory_items)) {
    row.inventory_items = p.inventory_items as InventoryItemJson[];
  }
  assign(row, "rent_due_day", p.rent_due_day as never);
  assign(row, "rent_payment_method", p.rent_payment_method as never);
  if (typeof p.maintenance_included === "boolean")
    row.maintenance_included = p.maintenance_included;
  assign(row, "maintenance_paise", p.maintenance_paise as never);
  assign(row, "electricity_allocation", p.electricity_paid_by as never);
  assign(row, "water_allocation", p.water_paid_by as never);
  assign(row, "gas_allocation", p.gas_paid_by as never);
  assign(row, "society_charges_allocation", p.society_charges_paid_by as never);
  assign(row, "late_payment_penalty_pct", p.late_payment_penalty_pct as never);
}

export function writeStep5(row: RentAgreementRow, p: AnyRecord): void {
  if (typeof p.pets_allowed === "boolean") row.pets_allowed = p.pets_allowed;
  if (typeof p.subletting_allowed === "boolean") row.subletting_allowed = p.subletting_allowed;
  if (typeof p.renovation_allowed === "boolean") row.renovation_allowed = p.renovation_allowed;
  if (typeof p.commercial_use_allowed === "boolean")
    row.commercial_use_allowed = p.commercial_use_allowed;
  assign(row, "max_occupants", p.max_occupants as never);
  if (Array.isArray(p.additional_terms)) {
    row.additional_terms = (p.additional_terms as unknown[]).filter(
      (x): x is string => typeof x === "string"
    );
  }
  if (p.witness_1 && typeof p.witness_1 === "object") row.witness_1 = p.witness_1 as WitnessJson;
  if (p.witness_2 && typeof p.witness_2 === "object") row.witness_2 = p.witness_2 as WitnessJson;
}

export function writeStep(
  row: RentAgreementRow,
  step: number,
  payload: unknown,
  encryptPan: (s: string) => Buffer
): void {
  const p = (payload ?? {}) as AnyRecord;
  switch (step) {
    case 1:
      writeStep1(row, p, encryptPan);
      break;
    case 2:
      writeStep2(row, p);
      break;
    case 3:
      writeStep3(row, p);
      break;
    case 4:
      writeStep4(row, p);
      break;
    case 5:
      writeStep5(row, p);
      break;
    // Steps 6 + 7 are markers — no row writes
  }
}
