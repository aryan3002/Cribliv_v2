import { Body, Controller, Inject, Param, Post, Req, UseFilters, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { AuthGuard } from "../../../common/auth.guard";
import { ok } from "../../../common/response";
import { RentAgreementExceptionFilter } from "../rent-agreement.exception-filter";
import { ESignService } from "./e-sign.service";

interface AuthedReq {
  user: { id: string; role: string };
}

@UseFilters(RentAgreementExceptionFilter)
@Controller("rent-agreement")
export class ESignController {
  constructor(@Inject(ESignService) private readonly svc: ESignService) {}

  @UseGuards(AuthGuard)
  @Throttle({ default: { ttl: 3600_000, limit: 10 } })
  @Post(":id/e-sign/initiate")
  async initiate(
    @Req() req: AuthedReq,
    @Param("id") id: string,
    @Body() body: { party: "owner" | "tenant" }
  ) {
    const session = await this.svc.initiate(req.user.id, id, body.party);
    return ok({
      session_id: session.sessionId,
      status: session.status,
      initiated_at: session.initiatedAt.toISOString(),
      otp_url: session.otpUrl
    });
  }

  @UseGuards(AuthGuard)
  @Throttle({ default: { ttl: 3600_000, limit: 20 } })
  @Post(":id/e-sign/verify")
  async verify(@Req() req: AuthedReq, @Param("id") id: string, @Body() body: { otp: string }) {
    const r = await this.svc.verify(req.user.id, id, body.otp);
    return ok({
      session_id: r.sessionId,
      status: r.status,
      signed_at: r.signedAt ? r.signedAt.toISOString() : null
    });
  }
}
