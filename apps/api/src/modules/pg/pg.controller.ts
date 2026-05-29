import { BadRequestException, Body, Controller, Post, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { AuthGuard } from "../../common/auth.guard";
import { RolesGuard } from "../../common/roles.guard";
import { Roles } from "../../common/roles.decorator";

/**
 * Legacy controller. Kept as a 308 redirect to /pg-operator/segment for one
 * release window. Validates input then redirects; remove after frontend
 * confirms full migration off /pg/segment.
 */
@Controller("pg")
@UseGuards(AuthGuard, RolesGuard)
@Roles("pg_operator")
export class PgController {
  @Post("segment")
  segment(@Body() body: { total_beds: number }, @Res() res: Response) {
    if (!Number.isFinite(body?.total_beds) || body.total_beds <= 0) {
      throw new BadRequestException({
        code: "invalid_bed_count",
        message: "invalid_bed_count: total_beds must be > 0"
      });
    }
    return res.redirect(308, "/v1/pg-operator/segment");
  }
}
