import { Body, Controller, Get, Inject, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { ok } from "../../common/response";
import { AuthGuard } from "../../common/auth.guard";

@Controller()
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post("auth/otp/send")
  async sendOtp(@Body() body: { phone_e164: string; purpose: string }) {
    return ok(await this.authService.sendOtp(body.phone_e164, body.purpose));
  }

  @Post("auth/otp/verify")
  async verifyOtp(
    @Body() body: { challenge_id: string; otp_code: string; device_fingerprint?: string }
  ) {
    return ok(await this.authService.verifyOtp(body.challenge_id, body.otp_code));
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
}
