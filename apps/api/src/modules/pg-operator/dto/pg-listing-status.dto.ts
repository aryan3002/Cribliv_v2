import { z } from "zod";

// Operator-controlled public visibility. draft / pending_review are NOT settable
// here — those move through the submit → admin-approval path.
export const UpdatePgListingStatusSchema = z.object({
  status: z.enum(["active", "paused", "archived"])
});

export type UpdatePgListingStatusBody = z.infer<typeof UpdatePgListingStatusSchema>;
