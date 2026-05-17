// Row-to-DTO mappers. PAN ciphertext is always stripped; presence is exposed via has_*_pan booleans.
// PAN decryption is reserved for the PDF renderer scope only (see Security §PAN handling).

import type { PlanId } from "./step-registry";

export type WizardStatus =
  | "draft"
  | "pending_payment"
  | "paid"
  | "generating_pdf"
  | "generated"
  | "expired"
  | "refunded";

export interface WitnessJson {
  name?: string;
  father_name?: string;
  address?: string;
  phone?: string | null;
}

export interface InventoryItemJson {
  item?: string;
  quantity?: number;
  condition?: string;
}

export interface RentAgreementRow {
  id: string;
  user_id: string;
  plan_id: PlanId | string;
  locale: string;
  idempotency_key: string;
  current_step: number;
  step_validated_at: Record<string, string>;
  status: WizardStatus | string;

  owner_full_name: string | null;
  owner_father_name: string | null;
  owner_age: number | null;
  owner_phone: string | null;
  owner_email: string | null;
  owner_permanent_address: string | null;
  owner_pan_ct: Buffer | null;
  owner_aadhaar_last4: string | null;

  tenant_full_name: string | null;
  tenant_father_name: string | null;
  tenant_age: number | null;
  tenant_phone: string | null;
  tenant_email: string | null;
  tenant_permanent_address: string | null;
  tenant_pan_ct: Buffer | null;
  tenant_aadhaar_last4: string | null;
  tenant_company_name: string | null;

  property_full_address: string | null;
  property_type: string | null;
  property_area_sqft: number | null;
  property_furnishing: string | null;
  property_purpose: string | null;
  property_parking: string | null;
  property_floor_number: number | null;
  property_total_floors: number | null;
  property_flat_number: string | null;
  property_municipal_number: string | null;
  property_survey_number: string | null;

  agreement_type: string | null;
  agreement_date: string | null;
  commencement_date: string | null;
  tenure_months: number | null;
  lock_in_months: number | null;
  notice_period_months: number | null;
  rent_amount_paise: number | null;
  security_deposit_paise: number | null;
  annual_increment_pct: number | null;
  state_code: string | null;
  city: string | null;
  acknowledge_registration_required: boolean;

  inventory_items: InventoryItemJson[];
  rent_due_day: number | null;
  rent_payment_method: string | null;
  maintenance_included: boolean | null;
  maintenance_paise: number | null;
  electricity_allocation: string | null;
  water_allocation: string | null;
  gas_allocation: string | null;
  society_charges_allocation: string | null;
  late_payment_penalty_pct: number | null;

  pets_allowed: boolean | null;
  subletting_allowed: boolean | null;
  renovation_allowed: boolean | null;
  commercial_use_allowed: boolean | null;
  max_occupants: number | null;
  additional_terms: string[];
  witness_1: WitnessJson | null;
  witness_2: WitnessJson | null;

  stamp_duty_paise: number;
  payment_order_id: string | null;
  pdf_blob_path: string | null;
  pdf_generated_at: string | null;
  download_count: number;
  max_downloads: number;
  expires_at: string | null;

  e_stamp_reference: string | null;
  e_sign_session_id: string | null;
  e_sign_completed_at: string | null;

  created_at: string;
  updated_at: string;
}

export interface DraftSummary {
  id: string;
  plan_id: string;
  locale: string;
  current_step: number;
  status: string;
  stamp_duty_paise: number;
  rent_amount_paise: number | null;
  has_owner_pan: boolean;
  has_tenant_pan: boolean;
  created_at: string;
  updated_at: string;
}

export type DraftFull = Omit<RentAgreementRow, "user_id" | "owner_pan_ct" | "tenant_pan_ct"> & {
  has_owner_pan: boolean;
  has_tenant_pan: boolean;
};

function hasCiphertext(buf: Buffer | null | undefined): boolean {
  return Buffer.isBuffer(buf) && buf.length > 0;
}

export function mapToSummary(row: RentAgreementRow): DraftSummary {
  return {
    id: row.id,
    plan_id: row.plan_id,
    locale: row.locale,
    current_step: row.current_step,
    status: row.status,
    stamp_duty_paise: row.stamp_duty_paise,
    rent_amount_paise: row.rent_amount_paise,
    has_owner_pan: hasCiphertext(row.owner_pan_ct),
    has_tenant_pan: hasCiphertext(row.tenant_pan_ct),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export function mapToFull(row: RentAgreementRow): DraftFull {
  const { user_id: _user, owner_pan_ct: _owner, tenant_pan_ct: _tenant, ...rest } = row;
  return {
    ...rest,
    has_owner_pan: hasCiphertext(row.owner_pan_ct),
    has_tenant_pan: hasCiphertext(row.tenant_pan_ct)
  };
}
