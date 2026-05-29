import { IsBoolean, IsInt, IsOptional, Min } from "class-validator";

export class PgSegmentRequestDto {
  @IsInt()
  @Min(1)
  total_beds!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  property_count?: number;

  @IsOptional()
  @IsBoolean()
  has_existing_listings?: boolean;
}
