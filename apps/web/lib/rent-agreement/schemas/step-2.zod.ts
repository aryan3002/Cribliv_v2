import { z } from "zod";

// Mirrors apps/api .../validators/step-2-property.dto.ts
export const PROPERTY_TYPES = ["flat", "house", "villa", "pg_room", "shop", "office"] as const;
export const FURNISHING_OPTIONS = ["unfurnished", "semi_furnished", "fully_furnished"] as const;
export const PURPOSE_OPTIONS = ["residential", "commercial", "mixed"] as const;
export const PARKING_OPTIONS = ["none", "two_wheeler", "four_wheeler", "both"] as const;

export const step2Schema = z.object({
  full_address: z.string().min(20).max(1000),
  type: z.enum(PROPERTY_TYPES),
  area_sqft: z.number().positive(),
  furnishing: z.enum(FURNISHING_OPTIONS),
  purpose: z.enum(PURPOSE_OPTIONS),
  parking: z.enum(PARKING_OPTIONS).optional(),
  floor_number: z.number().int().optional(),
  total_floors: z.number().int().min(1).optional(),
  flat_number: z.string().max(50).optional(),
  municipal_number: z.string().max(100).optional(),
  survey_number: z.string().max(100).optional()
});

export type Step2Payload = z.infer<typeof step2Schema>;
