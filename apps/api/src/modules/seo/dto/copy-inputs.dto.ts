import { Type } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested
} from "class-validator";

class LocalizedLabelDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  en!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  hi!: string;
}

class NearestMetroDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsInt()
  @Min(0)
  walk_minutes!: number;
}

class CopyAggregatesDto {
  @IsInt()
  @Min(0)
  listing_count!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  pg_count?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  flat_count?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  median_rent_pg?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  median_rent_1bhk?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  median_rent_2bhk?: number | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => NearestMetroDto)
  nearest_metro?: NearestMetroDto | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  parent_locality?: string | null;
}

export class CopyInputsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  pagePath!: string;

  @IsEnum(["en", "hi"])
  locale!: "en" | "hi";

  @ValidateNested()
  @Type(() => LocalizedLabelDto)
  placeName!: LocalizedLabelDto;

  @IsEnum(["city", "locality", "metro", "landmark"])
  placeKind!: "city" | "locality" | "metro" | "landmark";

  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedLabelDto)
  intentLabel?: LocalizedLabelDto | null;

  @IsObject()
  @ValidateNested()
  @Type(() => CopyAggregatesDto)
  aggregates!: CopyAggregatesDto;
}
