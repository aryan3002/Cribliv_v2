// Step 7 is a marker; final-agreement.schema runs against cumulative row state
// inside drafts.service.advance(). The body carries no field data, only an
// optional client acknowledgement — unknown fields are rejected upstream via
// `whitelist: true, forbidNonWhitelisted: true` to prevent override smuggling.

import { IsBoolean, IsOptional } from "class-validator";

export class Step7ReviewDto {
  @IsOptional()
  @IsBoolean()
  agree_to_terms?: boolean;
}
