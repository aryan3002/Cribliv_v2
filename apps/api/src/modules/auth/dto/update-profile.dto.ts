import { z } from "zod";
import { FullNameSchema } from "@cribliv/shared-types";

/**
 * Validation for PATCH /users/me.
 *
 * Until this existed the route had no runtime validation at all: the controller
 * declared an inline TS body type, which erases, and the global ValidationPipe
 * skips bodies whose metatype is Object. Any length and any bytes reached
 * users.full_name — which is rendered on owner lead lists, written into a CSV
 * owners download, and interpolated into outbound SMS/WhatsApp bodies.
 *
 * The name rules themselves live in @cribliv/shared-types so apps/web validates
 * identically; only the request envelope is defined here.
 */
export const UpdateProfileSchema = z.object({
  full_name: FullNameSchema.optional(),
  preferred_language: z.enum(["en", "hi"]).optional(),
  whatsapp_opt_in: z.boolean().optional()
});

export type UpdateProfileBody = z.infer<typeof UpdateProfileSchema>;
