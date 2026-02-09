import { BadRequestException, Body, Controller, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../common/auth.guard";
import { RolesGuard } from "../../common/roles.guard";
import { Roles } from "../../common/roles.decorator";
import { ok } from "../../common/response";

@Controller("pg")
@UseGuards(AuthGuard, RolesGuard)
@Roles("pg_operator")
export class PgController {
  @Post("segment")
  segment(@Body() body: { total_beds: number }) {
    if (!Number.isFinite(body.total_beds) || body.total_beds <= 0) {
      throw new BadRequestException({
        code: "invalid_bed_count",
        message: "total_beds must be > 0"
      });
    }

    const path = body.total_beds <= 29 ? "self_serve" : "sales_assist";
    return ok({
      path,
      next_step: path === "self_serve" ? "/owner/listings/new" : "/sales/lead-form"
    });
  }
}
