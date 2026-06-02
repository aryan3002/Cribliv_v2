import { z } from "zod";

export const PgDraftUpsertSchema = z.object({
  draft_id: z.string().uuid().optional(),
  payload: z.record(z.string(), z.unknown()),
  field_confidence: z.record(z.string(), z.number()).optional(),
  source: z.enum(["manual", "voice"]),
  pg_property_id: z.string().uuid().optional().nullable()
});

export type PgDraftUpsert = z.infer<typeof PgDraftUpsertSchema>;
