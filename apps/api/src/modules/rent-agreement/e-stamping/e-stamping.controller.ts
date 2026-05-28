import { Controller, Get, Inject, Param, Post, Req, UseFilters, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { AuthGuard } from "../../../common/auth.guard";
import { ok } from "../../../common/response";
import { RentAgreementExceptionFilter } from "../rent-agreement.exception-filter";
import { EStampingService } from "./e-stamping.service";

interface AuthedReq {
  user: { id: string; role: string };
}

@UseFilters(RentAgreementExceptionFilter)
@Controller("rent-agreement")
export class EStampingController {
  constructor(@Inject(EStampingService) private readonly svc: EStampingService) {}

  @UseGuards(AuthGuard)
  @Throttle({ default: { ttl: 3600_000, limit: 10 } })
  @Post(":id/e-stamp/issue")
  async issue(@Req() req: AuthedReq, @Param("id") id: string) {
    const r = await this.svc.issue(req.user.id, id);
    return ok({
      reference_id: r.referenceId,
      status: r.status,
      issued_at: r.issuedAt.toISOString()
    });
  }

  @UseGuards(AuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get(":id/e-stamp/status")
  async status(@Req() req: AuthedReq, @Param("id") id: string) {
    const r = await this.svc.status(req.user.id, id);
    return ok({
      reference_id: r.referenceId,
      status: r.status,
      issued_at: r.issuedAt.toISOString()
    });
  }
}
