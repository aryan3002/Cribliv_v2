import { z } from "zod";
import type { PgRentForfeitInput, PgRentSettleInput } from "@cribliv/shared-types";

import { isIsoDate } from "../../../common/date";

const isoDate = z.string().refine(isIsoDate, "must be a real YYYY-MM-DD date");

export const SettleSchema = z.object({
  deductions: z
    .array(
      z
        .object({
          kind: z.enum(["damage", "cleaning", "forfeit", "other"]),
          label: z.string().trim().min(1).max(40),
          amount_inr: z.number().int().min(1).max(1000000)
        })
        .strict()
    )
    .max(20),
  return_now: z
    .object({
      amount_inr: z.number().int().min(1).max(1000000),
      method: z.enum(["cash", "upi", "bank_transfer", "cheque", "card", "other"]),
      paid_on: isoDate,
      reference: z.string().trim().max(64).nullable().optional()
    })
    .strict()
    .nullable()
    .optional(),
  note: z.string().trim().max(200).nullable().optional()
}) satisfies z.ZodType<PgRentSettleInput, PgRentSettleInput>;

export const ForfeitSchema = z.object({
  amount_inr: z.number().int().min(1).max(1000000),
  label: z.string().trim().min(1).max(40).optional()
}) satisfies z.ZodType<PgRentForfeitInput, PgRentForfeitInput>;
