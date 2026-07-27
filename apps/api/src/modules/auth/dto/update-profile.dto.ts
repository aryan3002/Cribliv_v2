import { z } from "zod";
import { validateFullName } from "@cribliv/shared-types";

/**
 * Validation for PATCH /users/me.
 *
 * Until this existed the route had no runtime validation at all: the controller
 * declared an inline TS body type, which erases, and the global ValidationPipe
 * skips bodies whose metatype is Object. Any length and any bytes reached
 * users.full_name — which is rendered on owner lead lists, written into a CSV
 * owners download, and interpolated into outbound SMS/WhatsApp bodies.
 *
 * The name rules themselves live in @cribliv/shared-types (validateFullName) so
 * apps/web validates identically; only the request envelope, plus this thin
 * zod wrapper around that one function, is defined here. @cribliv/shared-types
 * has zero runtime dependencies on purpose — importing it must not pull zod
 * into the web bundle (see packages/shared-types/src/user-name.ts) — so zod
 * stays an API-only concern. This wraps validateFullName's result via
 * superRefine/transform rather than re-implementing the rules as a second set
 * of zod `.refine()`s, which is what @cribliv/shared-types used to do (a
 * `FullNameSchema` kept in agreement with validateFullName only by tests).
 */
const fullNameField = z
  .union([z.string(), z.null()])
  .superRefine((value, ctx) => {
    const result = validateFullName(value);
    if (!result.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.message });
    }
  })
  .transform((value) => {
    const result = validateFullName(value);
    return result.ok ? result.value : null;
  });

export const UpdateProfileSchema = z.object({
  full_name: fullNameField.optional(),
  preferred_language: z.enum(["en", "hi"]).optional(),
  whatsapp_opt_in: z.boolean().optional()
});

export type UpdateProfileBody = z.infer<typeof UpdateProfileSchema>;
