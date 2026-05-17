// Step 2 — Property DTO for the Rent Agreement v2 wizard.
// Pure structural validation (class-validator decorators only); no business rules.
// See API-Contract §B2 step 2 + §B4 for the source of truth.

import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  MaxLength,
  Min
} from "class-validator";

export const PROPERTY_TYPES = ["flat", "house", "villa", "pg_room", "shop", "office"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const FURNISHING_OPTIONS = ["unfurnished", "semi_furnished", "fully_furnished"] as const;
export type Furnishing = (typeof FURNISHING_OPTIONS)[number];

export const PURPOSE_OPTIONS = ["residential", "commercial", "mixed"] as const;
export type Purpose = (typeof PURPOSE_OPTIONS)[number];

export const PARKING_OPTIONS = ["none", "two_wheeler", "four_wheeler", "both"] as const;
export type Parking = (typeof PARKING_OPTIONS)[number];

export class Step2PropertyDto {
  @IsString()
  @Length(20, 1000)
  full_address!: string;

  @IsIn(PROPERTY_TYPES)
  type!: PropertyType;

  @IsNumber()
  @IsPositive()
  area_sqft!: number;

  @IsIn(FURNISHING_OPTIONS)
  furnishing!: Furnishing;

  @IsIn(PURPOSE_OPTIONS)
  purpose!: Purpose;

  @IsOptional()
  @IsIn(PARKING_OPTIONS)
  parking?: Parking;

  @IsOptional()
  @IsInt()
  floor_number?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  total_floors?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  flat_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  municipal_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  survey_number?: string;
}
