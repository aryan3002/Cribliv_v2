import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import { readFeatureFlags } from "../../config/feature-flags";
import { AuthGuard } from "../../common/auth.guard";
import { Roles } from "../../common/roles.decorator";
import { RolesGuard } from "../../common/roles.guard";
import { ok } from "../../common/response";
import { VerificationService } from "./verification.service";

@Controller("owner/verification")
@UseGuards(AuthGuard, RolesGuard)
@Roles("owner", "pg_operator")
export class VerificationController {
  constructor(
    @Inject(VerificationService) private readonly verificationService: VerificationService
  ) {}

  @Post("video")
  async video(
    @Req() req: { user: { id: string } },
    @Body() body: { listing_id: string; artifact_blob_path: string; vendor_reference?: string }
  ) {
    return ok(await this.verificationService.submitVideo(req.user.id, body));
  }

  @Post("electricity")
  async electricity(
    @Req() req: { user: { id: string } },
    @Body()
    body: {
      listing_id: string;
      consumer_id: string;
      address_text: string;
      bill_artifact_blob_path?: string;
    }
  ) {
    return ok(await this.verificationService.submitElectricity(req.user.id, body));
  }

  @Get("status")
  async status(@Req() req: { user: { id: string } }, @Query("listing_id") listingId: string) {
    return ok(await this.verificationService.status(req.user.id, listingId));
  }

  /**
   * Aadhaar OTP eKYC — placeholder pending Karza/Signzy contract.
   * Returns not_implemented until ff_aadhaar_ekyc_enabled is set.
   */
  @Post("aadhaar/initiate")
  async aadhaarInitiate() {
    const flags = readFeatureFlags();
    if (!flags.ff_aadhaar_ekyc_enabled) {
      throw new BadRequestException({
        code: "not_implemented",
        message: "Aadhaar eKYC not yet available"
      });
    }
    // Future: initiate OTP via Karza/Signzy integration
    throw new BadRequestException({
      code: "not_implemented",
      message: "Aadhaar eKYC not yet available"
    });
  }

  @Post("aadhaar/verify")
  async aadhaarVerify() {
    const flags = readFeatureFlags();
    if (!flags.ff_aadhaar_ekyc_enabled) {
      throw new BadRequestException({
        code: "not_implemented",
        message: "Aadhaar eKYC not yet available"
      });
    }
    throw new BadRequestException({
      code: "not_implemented",
      message: "Aadhaar eKYC not yet available"
    });
  }
}
