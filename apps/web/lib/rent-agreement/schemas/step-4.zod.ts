import { z } from "zod";

// Mirrors apps/api .../validators/step-4-inventory-utilities.dto.ts
const allocation = z.enum(["owner", "tenant", "shared"]);
const societyAllocation = z.enum(["owner", "tenant", "shared", "na"]);

export const INVENTORY_CONDITIONS = ["new", "good", "fair", "poor"] as const;
export const PAYMENT_METHODS = ["bank_transfer", "upi", "cheque", "cash"] as const;

export const step4Schema = z.object({
  inventory_items: z
    .array(
      z.object({
        item: z.string().min(1).max(200),
        quantity: z.number().int().min(1).max(1000),
        condition: z.enum(INVENTORY_CONDITIONS)
      })
    )
    .max(50)
    .default([]),
  rent_due_day: z.number().int().min(1).max(28),
  rent_payment_method: z.enum(PAYMENT_METHODS),
  maintenance_included: z.boolean(),
  maintenance_paise: z.number().int().min(0).optional(),
  electricity_paid_by: allocation,
  water_paid_by: allocation,
  gas_paid_by: allocation,
  society_charges_paid_by: societyAllocation,
  late_payment_penalty_pct: z.number().min(0).max(100)
});

export type Step4Payload = z.infer<typeof step4Schema>;
