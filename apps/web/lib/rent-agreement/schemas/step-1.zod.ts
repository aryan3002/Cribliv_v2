import { z } from "zod";

// Mirrors apps/api .../validators/step-1-parties.dto.ts + india-rules.validator.ts
const phoneIN = /^\+91[6-9]\d{9}$/;
const pan = /^[A-Z]{5}\d{4}[A-Z]$/;
const aadhaarLast4 = /^\d{4}$/;

const partySchema = z.object({
  full_name: z.string().min(2).max(200),
  father_name: z.string().min(2).max(200),
  age: z.number().int().min(18).max(120),
  phone: z.string().regex(phoneIN, "must be +91XXXXXXXXXX (E.164 India)"),
  email: z.string().email().optional(),
  permanent_address: z.string().min(10).max(500),
  pan: z.string().regex(pan, "must be PAN format ABCDE1234F").optional(),
  aadhaar_last4: z.string().regex(aadhaarLast4, "must be 4 digits").optional()
});

export const step1Schema = z.object({
  owner: partySchema,
  tenant: partySchema.extend({ tenant_company_name: z.string().optional() })
});

export type Step1Payload = z.infer<typeof step1Schema>;
