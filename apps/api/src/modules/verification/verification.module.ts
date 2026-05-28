import { Module } from "@nestjs/common";
import { VerificationController } from "./verification.controller";
import { VerificationService } from "./verification.service";
import { LivenessProvider } from "./providers/liveness.provider";
import { ElectricityProvider } from "./providers/electricity.provider";

@Module({
  controllers: [VerificationController],
  providers: [VerificationService, LivenessProvider, ElectricityProvider]
})
export class VerificationModule {}
