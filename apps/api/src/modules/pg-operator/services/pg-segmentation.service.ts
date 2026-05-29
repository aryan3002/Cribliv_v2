import { BadRequestException, Injectable } from "@nestjs/common";
import type { PgSegmentationResult } from "@cribliv/shared-types";
import { SEGMENTATION_RULES, type SegmentationInput } from "../config/segmentation-rules";

/**
 * Routes a PG operator into either self-serve (wizard) or sales-assist (lead form)
 * based on bed count, property count, and existing listing presence.
 *
 * Rule table externalised to ../config/segmentation-rules.ts for A/B testing.
 */
@Injectable()
export class PgSegmentationService {
  segment(input: SegmentationInput): PgSegmentationResult {
    if (!Number.isFinite(input.totalBeds) || input.totalBeds <= 0) {
      throw new BadRequestException({
        code: "invalid_bed_count",
        message: "invalid_bed_count: totalBeds must be a positive finite number"
      });
    }
    const rule = SEGMENTATION_RULES.find((r) => r.predicate(input));
    // Safe: last rule is catch-all
    return { path: rule!.path, reason: rule!.reason, next_step: rule!.next_step };
  }
}
