import { z } from "zod";

export const PgPropertyCreateSchema = z
  .object({
    display_name: z.string().min(2).max(120),
    city_slug: z
      .string()
      .min(1)
      .max(60)
      .regex(/^[a-z0-9-]+$/),
    locality_slug: z
      .string()
      .min(1)
      .max(60)
      .regex(/^[a-z0-9-]+$/)
      .optional(),
    internal_code: z.string().max(40).optional(),
    total_floors: z.number().int().min(1).max(50).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    formatted_address: z.string().max(300).optional()
  })
  .strict();

export type PgPropertyCreate = z.infer<typeof PgPropertyCreateSchema>;
