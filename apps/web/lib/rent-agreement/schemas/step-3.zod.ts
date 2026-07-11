import { z } from "zod";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export const step3Schema = z
  .object({
    agreement_type: z.enum(["new", "renewal"]),
    agreement_date: z.string().regex(isoDate),
    commencement_date: z.string().regex(isoDate),
    tenure_months: z.number().int().min(1).max(132),
    lock_in_months: z.number().int().min(0).max(132),
    notice_period_months: z.number().int().min(1).max(6),
    rent_amount_paise: z.number().int().positive(),
    security_deposit_paise: z.number().int().min(0),
    annual_increment_pct: z.number().min(0).max(100),
    state_code: z.string().regex(/^[A-Z]{2}$/),
    city: z.string().min(2),
    acknowledge_registration_required: z.boolean()
  })
  .refine((v) => v.lock_in_months <= v.tenure_months, {
    message: "lock_in_months must be <= tenure_months",
    path: ["lock_in_months"]
  })
  // D6: an agreement longer than 11 months legally requires registration.
  .refine((v) => v.tenure_months <= 11 || v.acknowledge_registration_required === true, {
    message: "Agreements longer than 11 months must be registered. Please acknowledge.",
    path: ["acknowledge_registration_required"]
  });

export type Step3Payload = z.infer<typeof step3Schema>;
