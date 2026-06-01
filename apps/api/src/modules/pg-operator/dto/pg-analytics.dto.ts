import { IsArray, IsInt, IsObject, IsOptional, IsString, Min } from "class-validator";

/**
 * Lenient by design — analytics is fire-and-forget. Only session_id is "expected"
 * (controller injects one if absent). whitelist:true strips unknown keys so a
 * malformed body can never 4xx.
 */
export class PgSearchEventDto {
  @IsOptional() @IsString() session_id?: string;
  @IsOptional() @IsString() query?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsObject() filters?: Record<string, unknown>;
  @IsOptional() @IsInt() @Min(0) result_count?: number;
  @IsOptional() @IsArray() shown_listing_ids?: string[];
  @IsOptional() @IsString() clicked_listing_id?: string;
  @IsOptional() @IsInt() @Min(0) clicked_position?: number;
  @IsOptional() @IsString() surface?: string;
}
