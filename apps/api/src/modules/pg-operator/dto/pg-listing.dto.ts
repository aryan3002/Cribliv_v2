import { z } from "zod";
import {
  AmenitiesSchema,
  FoodSchema,
  HouseRulesSchema,
  PaymentTermsSchema,
  PricingMatrixSchema,
  PropertyBasicsSchema
} from "../../voice-agent-pg/schema/pg-extraction-schema";

const PG_GENDER = ["boys", "girls", "coed"] as const;
const PG_TENANT_TYPE = ["students", "working", "any"] as const;

/**
 * Public-API DTO. Slug-based (city/locality) — service resolves to ids.
 * Composes the same Zod schemas used by voice extraction → single source of truth.
 */
export const PgListingCreateSchema = z
  .object({
    property: PropertyBasicsSchema.extend({
      city_slug: z.string().min(1),
      locality_slug: z.string().optional()
    }),
    pg_details: z
      .object({
        total_beds: z.number().int().min(1),
        // First-class filter fields
        gender_policy: z.enum(PG_GENDER).nullable().optional(),
        tenant_type: z.enum(PG_TENANT_TYPE).nullable().optional(),
        meals: FoodSchema.optional(),
        house_rules: HouseRulesSchema.omit({ gender_policy: true, tenant_type: true }).optional(),
        amenities: AmenitiesSchema.optional(),
        nearby: z
          .object({
            metro: z.array(z.string()).optional(),
            college: z.array(z.string()).optional(),
            office: z.array(z.string()).optional()
          })
          .optional(),
        // Payment terms inlined
        notice_period_days: z.number().int().min(0).max(180).nullable().optional(),
        lock_in_months: z.number().int().min(0).max(24).nullable().optional(),
        security_deposit_paise: z.number().int().nonnegative().optional(),
        deposit_refundable_pct: z.number().int().min(0).max(100).optional(),
        electricity_mode: z.enum(["flat", "submetered", "split_equally"]).nullable().optional(),
        maintenance_paise: z.number().int().nonnegative().nullable().optional(),
        rent_due_day: z.number().int().min(1).max(28).nullable().optional(),
        payment_modes: z.array(z.enum(["upi", "bank_transfer", "cash"])).optional(),
        late_fee_policy: z.record(z.string(), z.unknown()).nullable().optional(),
        price_negotiable: z.boolean().optional(),
        meal_charges_paise: z.number().int().nonnegative().nullable().optional()
      })
      .strict(),
    room_types: z.array(PricingMatrixSchema).min(1)
  })
  .strict();

export type PgListingCreate = z.infer<typeof PgListingCreateSchema>;
