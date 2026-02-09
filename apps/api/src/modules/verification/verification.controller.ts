import { Body, Controller, Get, Inject, Post, Query, Req, UseGuards } from "@nestjs/common";
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
}
