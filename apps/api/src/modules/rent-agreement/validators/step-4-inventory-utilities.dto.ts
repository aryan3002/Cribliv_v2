import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested
} from "class-validator";

/* ─── Inventory item (nested) ─── */
export class InventoryItemDto {
  @IsString()
  @Length(1, 200)
  item!: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  quantity!: number;

  @IsIn(["new", "good", "fair", "poor"])
  condition!: "new" | "good" | "fair" | "poor";
}

/**
 * Step 4 — Inventory + Utilities (API-Contract §B2 step 4).
 *
 * Structural validation only. The following are CROSS-FIELD rules and live in
 * `validators/cross-field.validator.ts`, not here:
 *   - `inventory_items` is required when `furnishing !== "unfurnished"`
 *     (already enforced — see `inventory_required_when_furnished`).
 *   - `maintenance_paise` is required when `maintenance_included === false`.
 *     NOTE: this rule is not yet wired into cross-field.validator.ts —
 *     flagged for follow-up.
 */
export class Step4InventoryUtilitiesDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => InventoryItemDto)
  inventory_items?: InventoryItemDto[];

  @IsInt()
  @Min(1)
  @Max(28)
  rent_due_day!: number;

  @IsIn(["bank_transfer", "upi", "cheque", "cash"])
  rent_payment_method!: "bank_transfer" | "upi" | "cheque" | "cash";

  @IsBoolean()
  maintenance_included!: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  maintenance_paise?: number;

  @IsIn(["owner", "tenant", "shared"])
  electricity_paid_by!: "owner" | "tenant" | "shared";

  @IsIn(["owner", "tenant", "shared"])
  water_paid_by!: "owner" | "tenant" | "shared";

  @IsIn(["owner", "tenant", "shared"])
  gas_paid_by!: "owner" | "tenant" | "shared";

  @IsIn(["owner", "tenant", "shared", "na"])
  society_charges_paid_by!: "owner" | "tenant" | "shared" | "na";

  @IsNumber()
  @Min(0)
  @Max(100)
  late_payment_penalty_pct!: number;
}
