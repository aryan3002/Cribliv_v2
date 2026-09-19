import { z } from "zod";
import type { PgRentTenantOverridesInput } from "@cribliv/shared-types";

import { isIsoDate } from "../../../common/date";

export const RentTenantOverridesSchema = z.object({
  rent_due_day: z.number().int().min(1).max(28).nullable().optional(),
  late_fee_exempt: z.boolean().optional(),
  late_fee_override_inr: z.number().int().min(1).max(10000).nullable().optional(),
  default_item_excludes: z
    .array(z.string().regex(/^[a-z0-9_]{1,24}$/))
    .max(10)
    .optional(),
  move_in_date: z.string().refine(isIsoDate).optional(),
  monthly_rent_inr: z.number().int().min(1).max(1000000).optional()
}) satisfies z.ZodType<PgRentTenantOverridesInput, PgRentTenantOverridesInput>;
