import { z } from "zod";

// Pipeline statuses — mirrors VALID_TRANSITIONS in leads.service.ts and the
// web client (apps/web/lib/pg-operator-api.ts PgLeadStatus). The transition
// graph itself is enforced in LeadsService.updateLeadStatus.
export const UpdatePgLeadStatusSchema = z.object({
  status: z.enum(["new", "contacted", "visit_scheduled", "deal_done", "lost"])
});

export type UpdatePgLeadStatusBody = z.infer<typeof UpdatePgLeadStatusSchema>;
