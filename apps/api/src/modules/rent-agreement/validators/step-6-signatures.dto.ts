// Step 6 advance-gate body for POST /:id/step/6/advance.
// Actual signature verification (presence of owner+tenant rows, image bytes,
// EXIF strip, plan check) is done in drafts.service.advance() + signatures
// pipeline. This DTO only locks down the wizard step's request shape so clients
// cannot smuggle signature uploads through the advance endpoint.

import { IsBoolean, IsOptional } from "class-validator";

export class Step6SignaturesDto {
  // Optional explicit advance gesture. The server does not require it — the
  // signature-presence check is the source of truth.
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}
