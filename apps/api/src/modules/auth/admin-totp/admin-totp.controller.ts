import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { AdminTotpService } from "./admin-totp.service";
import { AuthGuard } from "../../../common/auth.guard";
import { RolesGuard } from "../../../common/roles.guard";
import { Roles } from "../../../common/roles.decorator";
import { ok } from "../../../common/response";
import { readFeatureFlags } from "../../../config/feature-flags";

function assertEnabled(): void {
  if (!readFeatureFlags().ff_admin_totp) {
    throw new ForbiddenException({ code: "totp_disabled", message: "Admin TOTP is disabled" });
  }
}

@Controller()
export class AdminTotpController {
  constructor(@Inject(AdminTotpService) private readonly service: AdminTotpService) {}

  @UseGuards(AuthGuard, RolesGuard)
  @Roles("admin")
  @Post("auth/admin/totp/enroll/start")
  async enrollStart(@Req() req: { user: { id: string } }) {
    assertEnabled();
    return ok(await this.service.enrollStart(req.user.id));
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles("admin")
  @HttpCode(200)
  @Post("auth/admin/totp/enroll/verify")
  async enrollVerify(@Req() req: { user: { id: string } }, @Body() body: { totp_code: string }) {
    assertEnabled();
    return ok(await this.service.enrollVerify(req.user.id, body.totp_code));
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles("admin")
  @Get("auth/admin/totp/status")
  async status(@Req() req: { user: { id: string } }) {
    assertEnabled();
    return ok(await this.service.status(req.user.id));
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles("admin")
  @HttpCode(200)
  @Post("auth/admin/totp/reset")
  async reset(@Req() req: { user: { id: string } }) {
    assertEnabled();
    return ok(await this.service.reset(req.user.id));
  }

  // Public + strictly throttled: 10 attempts / 60s / IP (mirrors OTP routes).
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @HttpCode(200)
  @Post("auth/admin/login")
  async login(@Body() body: { phone_e164: string; totp_code: string }) {
    assertEnabled();
    return ok(await this.service.verifyLogin(body.phone_e164, body.totp_code));
  }
}
