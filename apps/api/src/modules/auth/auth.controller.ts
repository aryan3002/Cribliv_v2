import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Patch,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { AuthService } from "./auth.service";
import { ok } from "../../common/response";
import { AuthGuard } from "../../common/auth.guard";

@Controller()
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  // Strict rate limit: 10 OTP sends per 60s per IP
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post("auth/otp/send")
  async sendOtp(
    @Body() body: { phone_e164: string; purpose: string },
    @Req() req: { ip?: string; headers?: Record<string, string | string[] | undefined> }
  ) {
    const clientIp =
      (req.headers?.["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
    return ok(await this.authService.sendOtp(body.phone_e164, body.purpose, clientIp));
  }

  // Strict rate limit: 15 verify attempts per 60s per IP
  @Throttle({ default: { ttl: 60_000, limit: 15 } })
  @Post("auth/otp/verify")
  async verifyOtp(
    @Body() body: { challenge_id: string; otp_code: string; device_fingerprint?: string }
  ) {
    return ok(await this.authService.verifyOtp(body.challenge_id, body.otp_code));
  }

  @Post("auth/token/refresh")
  async refreshToken(@Body() body: { refresh_token: string }) {
    return ok(await this.authService.refreshToken(body.refresh_token));
  }

  @UseGuards(AuthGuard)
  @Post("auth/logout")
  async logout(@Body() body: { refresh_token: string }) {
    return ok(await this.authService.logout(body.refresh_token));
  }

  @UseGuards(AuthGuard)
  @Get("auth/me")
  async me(@Req() req: { user: { id: string; role: string } }) {
    return ok(await this.authService.getMe(req.user.id));
  }

  @UseGuards(AuthGuard)
  @Patch("users/me")
  async updateProfile(
    @Req() req: { user: { id: string } },
    @Body()
    body: { full_name?: string; preferred_language?: "en" | "hi"; whatsapp_opt_in?: boolean }
  ) {
    return ok(await this.authService.updateProfile(req.user.id, body));
  }

  /**
   * POST /users/me/role-request
   *
   * Any authenticated user may call this.
   * - Tenants → granted immediately (in-memory mode) or pending admin (DB mode)
   * - Already owner/pg_operator with same role → idempotent 200
   * - Different role clash → 400 already_has_role
   */
  @UseGuards(AuthGuard)
  @HttpCode(200)
  @Post("users/me/role-request")
  async requestRoleUpgrade(
    @Req() req: { user: { id: string } },
    @Body() body: { requested_role: "owner" | "pg_operator" }
  ) {
    if (!body.requested_role || !["owner", "pg_operator"].includes(body.requested_role)) {
      throw new Error("requested_role must be 'owner' or 'pg_operator'");
    }
    return ok(await this.authService.requestRoleUpgrade(req.user.id, body.requested_role));
  }
}
