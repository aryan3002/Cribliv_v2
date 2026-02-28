import { Type } from "class-transformer";
import {
  IsString,
  IsOptional,
  IsNumber,
  IsIn,
  IsBoolean,
  IsArray,
  ValidateNested,
  Min,
  Max,
  MinLength,
  MaxLength,
  ArrayMaxSize,
  Matches
} from "class-validator";

/* ─── Location ─── */
class LocationDto {
  @IsString()
  @MinLength(1)
  city!: string;

  @IsOptional()
  @IsString()
  locality?: string;

  @IsOptional()
  @IsString()
  address_line1?: string;

  @IsOptional()
  @IsString()
  landmark?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: "pincode must be a 6-digit number" })
  pincode?: string;

  @IsOptional()
  @IsString()
  masked_address?: string;
}

/* ─── Property fields (flat/house) ─── */
class PropertyFieldsDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(20)
  bhk?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  bathrooms?: number;

  @IsOptional()
  @IsNumber()
  @Min(50)
  @Max(100_000)
  area_sqft?: number;

  @IsOptional()
  @IsIn(["unfurnished", "semi_furnished", "fully_furnished"])
  furnishing?: string;

  @IsOptional()
  @IsIn(["any", "family", "bachelor", "female", "male"])
  preferred_tenant?: string;
}

/* ─── PG fields ─── */
class PgFieldsDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10_000)
  total_beds?: number;

  @IsOptional()
  @IsIn(["male", "female", "co_living"])
  occupancy_type?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(4)
  room_sharing_options?: string[];

  @IsOptional()
  @IsBoolean()
  food_included?: boolean;

  @IsOptional()
  @IsString()
  curfew_time?: string;

  @IsOptional()
  @IsBoolean()
  attached_bathroom?: boolean;
}

/* ─── Create listing body ─── */
export class CreateListingDto {
  @IsString()
  @MinLength(5, { message: "Title must be at least 5 characters" })
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsIn(["flat_house", "pg"])
  listing_type!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10_000_000)
  rent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10_000_000)
  deposit?: number;

  @ValidateNested()
  @Type(() => LocationDto)
  location!: LocationDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PropertyFieldsDto)
  property_fields?: PropertyFieldsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PgFieldsDto)
  pg_fields?: PgFieldsDto;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(30)
  amenities?: string[];
}

/* ─── Update listing body (everything optional except listing_type) ─── */
export class UpdateListingDto {
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsIn(["flat_house", "pg"])
  listing_type?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10_000_000)
  rent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10_000_000)
  deposit?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocationDto)
  location?: LocationDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PropertyFieldsDto)
  property_fields?: PropertyFieldsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PgFieldsDto)
  pg_fields?: PgFieldsDto;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(30)
  amenities?: string[];
}

/* ─── Submit listing body ─── */
export class SubmitListingDto {
  @IsOptional()
  @IsBoolean()
  agree_terms?: boolean;
}
