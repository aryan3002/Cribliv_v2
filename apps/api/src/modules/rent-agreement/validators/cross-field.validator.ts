import { isValidPan } from "./india-rules.validator";

export const HIGH_RENT_PAN_THRESHOLD_PAISE = 5_000_000;

export interface InventoryItemLike {
  item?: string;
  quantity?: number;
  condition?: string;
}

export interface CrossFieldRow {
  tenure_months?: number;
  lock_in_months?: number;
  rent_amount_paise?: number;
  owner_pan?: string;
  tenant_pan?: string;
  acknowledge_registration_required?: boolean;
  furnishing?: string;
  inventory_items?: InventoryItemLike[];
}

export interface CrossFieldError {
  code: string;
  field: string;
  message: string;
}

export function validateCrossField(row: CrossFieldRow): CrossFieldError[] {
  const errors: CrossFieldError[] = [];

  if (
    typeof row.tenure_months === "number" &&
    typeof row.lock_in_months === "number" &&
    row.lock_in_months > row.tenure_months
  ) {
    errors.push({
      code: "lock_in_exceeds_tenure",
      field: "lock_in_months",
      message: "Lock-in months must be less than or equal to tenure months"
    });
  }

  if (
    typeof row.rent_amount_paise === "number" &&
    row.rent_amount_paise > HIGH_RENT_PAN_THRESHOLD_PAISE
  ) {
    if (!isValidPan(row.owner_pan)) {
      errors.push({
        code: "owner_pan_required_high_rent",
        field: "owner.pan",
        message: "Owner PAN is required when monthly rent exceeds ₹50,000"
      });
    }
    if (!isValidPan(row.tenant_pan)) {
      errors.push({
        code: "tenant_pan_required_high_rent",
        field: "tenant.pan",
        message: "Tenant PAN is required when monthly rent exceeds ₹50,000"
      });
    }
  }

  if (typeof row.tenure_months === "number" && row.tenure_months > 11) {
    if (row.acknowledge_registration_required !== true) {
      errors.push({
        code: "registration_ack_required",
        field: "acknowledge_registration_required",
        message: "Agreements longer than 11 months require registration acknowledgement"
      });
    }
  }

  if (typeof row.furnishing === "string" && row.furnishing !== "unfurnished") {
    const items = row.inventory_items;
    if (!Array.isArray(items) || items.length < 1) {
      errors.push({
        code: "inventory_required_when_furnished",
        field: "inventory_items",
        message: "At least one inventory item is required when property is furnished"
      });
    }
  }

  return errors;
}
