// India-specific regex helpers shared by step DTOs and cross-field rules.
// All `isValid*` helpers return false on non-string inputs rather than throwing.

export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const PHONE_REGEX = /^\+91[6-9]\d{9}$/;
export const AADHAAR_LAST4_REGEX = /^\d{4}$/;
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isValidPan(value: unknown): boolean {
  return isString(value) && PAN_REGEX.test(value);
}

export function isValidIndianPhone(value: unknown): boolean {
  return isString(value) && PHONE_REGEX.test(value);
}

export function isValidAadhaarLast4(value: unknown): boolean {
  return isString(value) && AADHAAR_LAST4_REGEX.test(value);
}

export function isValidGSTIN(value: unknown): boolean {
  return isString(value) && GSTIN_REGEX.test(value);
}
