import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { D7OtpClient } from "./d7-otp.client";
import { AdminTotpController } from "./admin-totp/admin-totp.controller";
import { AdminTotpService } from "./admin-totp/admin-totp.service";
import { WhatsAppClient } from "../notifications/whatsapp.client";
import { D7OtpProvider } from "./otp/d7-otp.provider";
import { MockOtpProvider } from "./otp/mock-otp.provider";
import { WhatsAppOtpProvider } from "./otp/whatsapp-otp.provider";
import { OtpProviderResolver } from "./otp/otp-provider.resolver";

@Module({
  controllers: [AuthController, AdminTotpController],
  providers: [
    AuthService,
    D7OtpClient,
    AdminTotpService,
    WhatsAppClient,
    MockOtpProvider,
    WhatsAppOtpProvider,
    D7OtpProvider,
    OtpProviderResolver
  ],
  exports: [AuthService, AdminTotpService]
})
export class AuthModule {}
