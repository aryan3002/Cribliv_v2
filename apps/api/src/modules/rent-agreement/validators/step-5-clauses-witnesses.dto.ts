// Step 5 DTO — clauses + witnesses (per API Contract §B2 step 5).
// Validates discretionary clause flags, occupancy limit, free-form additional terms
// (sanitized to strip HTML and control chars), and two mandatory witness blocks.

import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested
} from "class-validator";

import { PHONE_REGEX } from "./india-rules.validator";

/**
 * Sanitize a single additional-term entry:
 *   1. Strip HTML tags
 *   2. Strip ASCII control characters (0x00–0x1F and 0x7F)
 *   3. Trim surrounding whitespace
 * Non-string values pass through unchanged so validators can flag them.
 */
function sanitizeAdditionalTerm(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return (
    value
      .replace(/<[^>]*>/g, "")
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1F\x7F]/g, "")
      .trim()
  );
}

export class WitnessDto {
  @IsString()
  @Length(2, 200)
  name!: string;

  @IsString()
  @Length(2, 200)
  father_name!: string;

  @IsString()
  @Length(10, 500)
  address!: string;

  @IsOptional()
  @IsString()
  @Matches(PHONE_REGEX, { message: "phone must match Indian mobile format (+91[6-9]XXXXXXXXX)" })
  phone?: string;
}

export class Step5ClausesWitnessesDto {
  @IsBoolean()
  pets_allowed!: boolean;

  @IsBoolean()
  subletting_allowed!: boolean;

  @IsBoolean()
  renovation_allowed!: boolean;

  @IsBoolean()
  commercial_use_allowed!: boolean;

  @IsInt()
  @Min(1)
  @Max(50)
  max_occupants!: number;

  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value.map(sanitizeAdditionalTerm) : value), {
    toClassOnly: true
  })
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  additional_terms?: string[];

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => WitnessDto)
  witness_1!: WitnessDto;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => WitnessDto)
  witness_2!: WitnessDto;
}
