import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { readFeatureFlags } from "../../config/feature-flags";
import { AuthGuard } from "../../common/auth.guard";
import { Roles } from "../../common/roles.decorator";
import { RolesGuard } from "../../common/roles.guard";
import { ok } from "../../common/response";
import {
  VerificationArtifactStorageService,
  VIDEO_MAX_BYTES,
  type VerificationArtifactKind
} from "./verification-artifact-storage.service";
import { VerificationService } from "./verification.service";
import type {} from "multer";

@Controller("owner/verification")
@UseGuards(AuthGuard, RolesGuard)
@Roles("owner", "pg_operator")
export class VerificationController {
  constructor(
    @Inject(VerificationService) private readonly verificationService: VerificationService,
    @Inject(VerificationArtifactStorageService)
    private readonly artifactStorage: VerificationArtifactStorageService
  ) {}

  @Post("artifacts/presign")
  async presign(
    @Req() req: { user: { id: string } },
    @Body()
    body: {
      listing_id: string;
      kind: VerificationArtifactKind;
      content_type: string;
      size_bytes: number;
      file_name: string;
    }
  ) {
    const target = await this.artifactStorage.createTarget({
      ownerId: req.user.id,
      listingId: body.listing_id,
      kind: body.kind,
      contentType: body.content_type,
      sizeBytes: Number(body.size_bytes),
      fileName: body.file_name
    });

    return ok({
      upload_token: target.uploadToken,
      upload_url: target.uploadUrl,
      blob_path: target.blobPath,
      expires_at: target.expiresAt
    });
  }

  @Post("artifacts/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: VIDEO_MAX_BYTES } }))
  async upload(
    @Req() req: { user: { id: string } },
    @Body() body: { upload_token?: string },
    @UploadedFile() file?: Express.Multer.File
  ) {
    if (!body.upload_token) {
      throw new BadRequestException({
        code: "upload_token_required",
        message: "upload_token is required"
      });
    }
    if (!file) {
      throw new BadRequestException({ code: "file_required", message: "file is required" });
    }

    const result = await this.artifactStorage.upload({
      ownerId: req.user.id,
      uploadToken: body.upload_token,
      file
    });
    return ok({ blob_path: result.blobPath });
  }

  @Post("artifacts/complete")
  async complete(
    @Req() req: { user: { id: string } },
    @Body()
    body: {
      listing_id: string;
      upload_token: string;
      blob_path: string;
    }
  ) {
    const result = await this.artifactStorage.complete({
      ownerId: req.user.id,
      listingId: body.listing_id,
      uploadToken: body.upload_token,
      blobPath: body.blob_path
    });
    return ok({ blob_path: result.blobPath });
  }

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
