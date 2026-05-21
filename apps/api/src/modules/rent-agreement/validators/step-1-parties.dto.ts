// Step 1 — Parties (owner + tenant) DTOs.
// Structural validation only: PII format checks per API-Contract §B4 + Security §PII.
// No business logic (cross-field rules live in cross-field.validator.ts).

import { Type } from "class-transformer";
import {
  IsDefined,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested
} from "class-validator";

import { AADHAAR_LAST4_REGEX, PAN_REGEX, PHONE_REGEX } from "./india-rules.validator";

export class PartyDto {
  @IsString()
  @Length(2, 200)
  full_name!: string;

  @IsString()
  @Length(2, 200)
  father_name!: string;

  @IsInt()
  @Min(18)
  @Max(120)
  age!: number;

  @IsString()
  @Matches(PHONE_REGEX, {
    message: "phone must be a valid Indian mobile in +91XXXXXXXXXX format"
  })
  phone!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  @Length(10, 500)
  permanent_address!: string;

  @IsOptional()
  @IsString()
  @Matches(PAN_REGEX, { message: "pan must match AAAAA9999A format" })
  pan?: string;

  @IsOptional()
  @IsString()
  @Matches(AADHAAR_LAST4_REGEX, {
    message: "aadhaar_last4 must be exactly 4 digits"
  })
  aadhaar_last4?: string;
}

export class Step1PartiesDto {
  @IsDefined({ message: "owner is required" })
  @ValidateNested()
  @Type(() => PartyDto)
  owner!: PartyDto;

  @IsDefined({ message: "tenant is required" })
  @ValidateNested()
  @Type(() => PartyDto)
  tenant!: PartyDto;
}
