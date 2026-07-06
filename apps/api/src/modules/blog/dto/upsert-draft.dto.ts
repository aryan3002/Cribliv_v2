import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength
} from "class-validator";

export class UpsertDraftDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  slug!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  meta_title?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(320)
  meta_description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  excerpt?: string | null;

  @IsOptional()
  @IsString()
  body_en?: string | null;

  @IsOptional()
  @IsString()
  body_hi?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  target_keyword?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  intent?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city_slug?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category_slug?: string | null;

  @IsIn(["planner", "manual", "refresh", "pillar"])
  generated_by!: "planner" | "manual" | "refresh" | "pillar";

  @IsIn(["draft", "needs_attention"])
  status!: "draft" | "needs_attention";

  @IsOptional()
  @IsNumber()
  quality_score?: number | null;

  @IsOptional()
  @IsObject()
  quality_breakdown?: Record<string, unknown> | null;

  @IsOptional()
  @IsArray()
  faq_items?: Array<{ q: string; a: string }>;

  @IsOptional()
  @IsString()
  hero_image_path?: string | null;

  @IsOptional()
  @IsArray()
  sources?: Array<{
    label: string;
    url?: string | null;
    asof?: string | null;
  }>;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  data_asof?: string | null;

  @IsOptional()
  @IsIn(["en", "hi", "hinglish"])
  script?: "en" | "hi" | "hinglish";

  @IsOptional()
  @IsString()
  brief_id?: string | null;
}
