import { PaymentTermsSchema } from "../schema/pg-extraction-schema";
import type { ToolDefinition, ToolHandler, ToolResult } from "./types";

const PREFIX = "pg_details";
const CONFIDENCE = 0.85;

const handler: ToolHandler = (input): ToolResult => {
  const r = PaymentTermsSchema.safeParse(input);
  if (!r.success) {
    return {
      ok: false,
      extracted: [],
      errors: r.error.issues.map((iss) => ({
        field: iss.path.join("."),
        code: iss.code,
        message: iss.message
      }))
    };
  }
  const v = r.data;
  const extracted: ToolResult["extracted"] = [];
  const push = (k: string, val: unknown) => {
    if (val != null)
      extracted.push({ field: `${PREFIX}.${k}`, value: val, confidence: CONFIDENCE });
  };
  push("notice_period_days", v.notice_period_days);
  push("lock_in_months", v.lock_in_months);
  push("electricity_mode", v.electricity_mode);
  push("maintenance_paise", v.maintenance_paise);
  push("rent_due_day", v.rent_due_day);
  if (v.payment_modes.length)
    extracted.push({
      field: `${PREFIX}.payment_modes`,
      value: v.payment_modes,
      confidence: CONFIDENCE
    });
  return { ok: true, extracted, errors: [] };
};

export const extractPaymentTermsTool: ToolDefinition = {
  name: "extract_payment_terms",
  description:
    "Extract notice_period_days, lock_in_months, electricity_mode (flat/submetered/split_equally), maintenance_paise, rent_due_day (1-28), payment_modes[]. Money in paise.",
  handler
};
