import { z } from "zod";

// Matches the shipped web client contract in apps/web/lib/pg-funnel.ts (PgFunnelEvent).
// Permissive metadata (commit-time validation lesson): never reject best-effort
// telemetry on shape drift — the server attaches operator_user_id from the token.
export const PgFunnelEventSchema = z.object({
  event_type: z.enum([
    "wizard_started",
    "step_completed",
    "geocode_resolved",
    "photos_added",
    "draft_saved",
    "submitted",
    "published",
    "abandoned"
  ]),
  source: z.enum(["manual", "voice"]),
  step_no: z.number().int().min(1).max(7).optional(),
  draft_id: z.string().uuid().optional(),
  listing_id: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export type PgFunnelEventBody = z.infer<typeof PgFunnelEventSchema>;
