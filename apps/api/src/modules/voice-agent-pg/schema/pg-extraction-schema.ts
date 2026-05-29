import { z } from "zod";

// Enum allowlists — single source of truth for both DB enums and Zod parsing.
const PG_SHARING = ["single", "double", "triple", "quad", "dorm"] as const;
const PG_BATHROOM = [
  "attached_western",
  "attached_indian",
  "shared_western",
  "shared_indian"
] as const;
const PG_FURNISHING = ["unfurnished", "semi_furnished", "fully_furnished"] as const;
const PG_GENDER = ["boys", "girls", "coed"] as const;
const PG_TENANT_TYPE = ["students", "working", "any"] as const;
const PG_ELECTRICITY = ["flat", "submetered", "split_equally"] as const;
const PAYMENT_MODE = ["upi", "bank_transfer", "cash"] as const;

const AMENITY_CORE = ["wifi", "hot_water", "power_backup", "cctv", "security_guard"] as const;
const AMENITY_ROOM = ["ac", "tv", "study_table", "wardrobe", "safety_locker", "mattress"] as const;
const AMENITY_SERVICES = ["housekeeping", "laundry", "biometric_access"] as const;
const AMENITY_EXTRAS = [
  "parking_2w",
  "parking_4w",
  "fridge",
  "microwave",
  "gym",
  "indoor_games"
] as const;

// Money in paise (int). Sanity cap ₹2 crore.
const PaiseSchema = z.number().int().nonnegative().max(2_000_000_000);

export const PropertyBasicsSchema = z
  .object({
    display_name: z.string().min(1).max(120),
    internal_code: z.string().max(40).nullable().optional(),
    total_floors: z.number().int().min(1).max(50).nullable().optional()
  })
  .strict();

export const RoomConfigSchema = z
  .object({
    total_beds: z.number().int().min(1).max(500),
    sharing_options: z.array(z.enum(PG_SHARING)).min(1),
    bathroom_kind: z.enum(PG_BATHROOM).nullable().optional(),
    furnishing: z.enum(PG_FURNISHING).nullable().optional()
  })
  .strict();

export const PricingMatrixSchema = z
  .object({
    sharing: z.enum(PG_SHARING),
    ac: z.boolean(),
    bathroom_kind: z.enum(PG_BATHROOM).optional().default("attached_western"),
    furnishing: z.enum(PG_FURNISHING).optional().default("semi_furnished"),
    monthly_rent_paise: PaiseSchema.refine((v) => v >= 200_000 && v <= 5_000_000, {
      message: "monthly_rent_paise must be between ₹2,000 (200000) and ₹50,000 (5000000)"
    }),
    vacancy_count: z.number().int().min(0).max(500),
    security_deposit_paise: PaiseSchema.optional(),
    deposit_refundable_pct: z.number().int().min(0).max(100).optional(),
    available_from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional()
  })
  .strict();

export const PaymentTermsSchema = z
  .object({
    notice_period_days: z.number().int().min(0).max(180).nullable().optional(),
    lock_in_months: z.number().int().min(0).max(24).nullable().optional(),
    electricity_mode: z.enum(PG_ELECTRICITY).nullable().optional(),
    maintenance_paise: PaiseSchema.nullable().optional(),
    rent_due_day: z.number().int().min(1).max(28).nullable().optional(),
    payment_modes: z.array(z.enum(PAYMENT_MODE)).optional().default([])
  })
  .strict();

export const AmenitiesSchema = z
  .object({
    core: z.array(z.enum(AMENITY_CORE)).optional().default([]),
    room: z.array(z.enum(AMENITY_ROOM)).optional().default([]),
    services: z.array(z.enum(AMENITY_SERVICES)).optional().default([]),
    extras: z.array(z.enum(AMENITY_EXTRAS)).optional().default([])
  })
  .strict();

export const FoodSchema = z
  .object({
    provided: z.boolean(),
    breakfast: z.boolean().optional(),
    lunch: z.boolean().optional(),
    snack: z.boolean().optional(),
    dinner: z.boolean().optional(),
    veg_only: z.boolean().optional(),
    meal_charges_paise: PaiseSchema.nullable().optional()
  })
  .strict();

export const HouseRulesSchema = z
  .object({
    // Filter-critical fields surface at pg_details column level — voice may extract here
    // and orchestrator hoists to top-level pg_details on draft commit.
    gender_policy: z.enum(PG_GENDER).nullable().optional(),
    tenant_type: z.enum(PG_TENANT_TYPE).nullable().optional(),
    curfew_time: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullable()
      .optional(),
    guests_policy: z.string().max(400).nullable().optional(),
    smoking: z.boolean(),
    alcohol: z.boolean(),
    non_veg: z.boolean(),
    pets: z.boolean(),
    cooking_in_room: z.boolean(),
    quiet_hours: z
      .object({
        from: z.string().regex(/^\d{2}:\d{2}$/),
        to: z.string().regex(/^\d{2}:\d{2}$/)
      })
      .nullable()
      .optional()
  })
  .strict();

export const SCHEMA_BY_TOOL = {
  extract_property_basics: PropertyBasicsSchema,
  extract_room_config: RoomConfigSchema,
  extract_pricing_matrix: PricingMatrixSchema,
  extract_payment_terms: PaymentTermsSchema,
  extract_amenities: AmenitiesSchema,
  extract_food: FoodSchema,
  extract_house_rules: HouseRulesSchema
} as const;

export type SchemaByTool = typeof SCHEMA_BY_TOOL;
