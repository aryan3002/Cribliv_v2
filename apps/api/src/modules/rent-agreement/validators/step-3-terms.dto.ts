// Step 3 — Terms DTO for Rent Agreement v2 (API Contract §B4).
// Structural per-field validation only. Cross-field rules
// (lock_in <= tenure, tenure > 11 => ack required) live in
// `cross-field.validator.ts`.

import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsDate,
  IsIn,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxDate,
  Min
} from "class-validator";

// Strict ISO-8601 date(-time) shape. Accepts "YYYY-MM-DD" and
// "YYYY-MM-DDTHH:mm:ss(.sss)?(Z|±HH:mm)?" forms — same set @IsISO8601
// accepts by default — and nothing else (e.g. rejects "01/05/2026").
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Coerce an ISO-shaped string to a Date for downstream @MaxDate / @IsDate
 * checks. Anything that doesn't match ISO_DATE_REGEX is passed through
 * unchanged, leaving @IsDate (and @MaxDate, which also requires a Date)
 * to reject it.
 */
function toIsoDate({ value }: { value: unknown }): unknown {
  if (typeof value !== "string") return value;
  if (!ISO_DATE_REGEX.test(value)) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d;
}

export class Step3TermsDto {
  @IsIn(["new", "renewal"])
  agreement_type!: "new" | "renewal";

  // Spec: @IsISO8601 + @MaxDate(() => new Date()) with @Type(() => Date).
  // Deviation: class-validator's @IsISO8601 only validates strings, but
  // @Type(() => Date) coerces away the string before validation. We use
  // a @Transform that coerces only ISO-shaped strings to Date (others
  // pass through and fail @IsDate), then @IsDate + @MaxDate enforce the
  // contract. Net behaviour matches the spec.
  @Transform(toIsoDate, { toClassOnly: true })
  @IsDate()
  @MaxDate(() => new Date(), {
    message: "agreement_date must be today or earlier"
  })
  agreement_date!: string;

  @IsISO8601()
  commencement_date!: string;

  @IsInt()
  @Min(1)
  @Max(132)
  tenure_months!: number;

  @IsInt()
  @Min(0)
  lock_in_months!: number;

  @IsInt()
  @Min(1)
  @Max(6)
  notice_period_months!: number;

  @IsInt()
  @Min(1)
  rent_amount_paise!: number;

  @IsInt()
  @Min(0)
  security_deposit_paise!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  annual_increment_pct!: number;

  // Two-letter state code (e.g. "KA"). Uppercase enforced.
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/, {
    message: "state_code must be 2 uppercase letters"
  })
  state_code!: string;

  @IsString()
  @Length(2, 120)
  city!: string;

  @IsOptional()
  @IsBoolean()
  acknowledge_registration_required?: boolean;
}
