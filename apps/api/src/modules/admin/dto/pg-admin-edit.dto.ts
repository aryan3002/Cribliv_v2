import { z } from "zod";
import { PricingMatrixSchema } from "../../voice-agent-pg/schema/pg-extraction-schema";

const PG_GENDER = ["boys", "girls", "coed"] as const;
const PG_TENANT = ["students", "working", "any"] as const;
const PG_ELECTRICITY = ["flat", "submetered", "split_equally"] as const;
const PAYMENT_MODE = ["upi", "bank_transfer", "cash"] as const;

// jsonb blobs the admin UI round-trips (built from what it loaded). Validated
// leniently — the column is jsonb and the operator schema already gate-kept the
// shape on create; admin edits are partial and trusted.
const JsonObject = z.record(z.string(), z.unknown());

/**
 * Partial patch for the admin Details tab. All keys optional — only provided
 * keys change. Scalar bounds mirror the create DTO / pg_details constraints.
 */
export const PgAdminDetailsPatchSchema = z
  .object({
    // Per-listing public title (pg_listings.title + public projection listings.title_en).
    // Distinct from the building/property name edited in the Location tab.
    title: z.string().trim().min(2).max(120).optional(),
    total_beds: z.number().int().min(1).max(500).optional(),
    gender_policy: z.enum(PG_GENDER).nullable().optional(),
    tenant_type: z.enum(PG_TENANT).nullable().optional(),
    security_deposit_paise: z.number().int().nonnegative().optional(),
    deposit_refundable_pct: z.number().int().min(0).max(100).optional(),
    notice_period_days: z.number().int().min(0).max(180).nullable().optional(),
    lock_in_months: z.number().int().min(0).max(24).nullable().optional(),
    electricity_mode: z.enum(PG_ELECTRICITY).nullable().optional(),
    maintenance_paise: z.number().int().nonnegative().nullable().optional(),
    rent_due_day: z.number().int().min(1).max(28).nullable().optional(),
    price_negotiable: z.boolean().optional(),
    payment_modes: z.array(z.enum(PAYMENT_MODE)).optional(),
    meals: JsonObject.nullable().optional(),
    meal_charges_paise: z.number().int().nonnegative().nullable().optional(),
    amenities: JsonObject.optional(),
    house_rules: JsonObject.optional(),
    nearby: JsonObject.nullable().optional()
  })
  .strict();

export type PgAdminDetailsPatchDto = z.infer<typeof PgAdminDetailsPatchSchema>;

/** Full room-set replacement for the admin Rooms tab. */
export const PgAdminRoomsPutSchema = z
  .object({
    rooms: z.array(PricingMatrixSchema).min(1)
  })
  .strict();

export type PgAdminRoomsPutDto = z.infer<typeof PgAdminRoomsPutSchema>;
