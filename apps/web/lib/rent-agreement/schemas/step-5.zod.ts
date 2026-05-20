import { z } from "zod";

// Mirrors apps/api .../validators/step-5-clauses-witnesses.dto.ts
const witness = z.object({
  name: z.string().min(2).max(200),
  father_name: z.string().min(2).max(200),
  address: z.string().min(10).max(500),
  phone: z.string().optional().nullable()
});

export const step5Schema = z.object({
  pets_allowed: z.boolean(),
  subletting_allowed: z.boolean(),
  renovation_allowed: z.boolean(),
  commercial_use_allowed: z.boolean(),
  max_occupants: z.number().int().min(1).max(50),
  additional_terms: z.array(z.string().max(500)).max(10).default([]),
  witness_1: witness,
  witness_2: witness
});

export type Step5Payload = z.infer<typeof step5Schema>;
