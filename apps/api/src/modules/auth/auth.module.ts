import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { D7OtpClient } from "./d7-otp.client";

@Module({
  controllers: [AuthController],
  providers: [AuthService, D7OtpClient],
  exports: [AuthService]
})
export class AuthModule {}
