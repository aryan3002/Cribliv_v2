import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { D7OtpClient } from "./d7-otp.client";
import { AdminTotpController } from "./admin-totp/admin-totp.controller";
import { AdminTotpService } from "./admin-totp/admin-totp.service";

@Module({
  controllers: [AuthController, AdminTotpController],
  providers: [AuthService, D7OtpClient, AdminTotpService],
  exports: [AuthService, AdminTotpService]
})
export class AuthModule {}
