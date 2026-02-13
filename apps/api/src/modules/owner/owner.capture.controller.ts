import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  ParseFilePipeBuilder,
  Post,
  Req,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthGuard } from "../../common/auth.guard";
import { Roles } from "../../common/roles.decorator";
import { RolesGuard } from "../../common/roles.guard";
import { ok } from "../../common/response";
import { OwnerCaptureService } from "./owner.capture.service";
import { ListingType, SupportedCaptureLocale } from "./owner.capture.types";

@Controller("owner/listings/capture")
@UseGuards(AuthGuard, RolesGuard)
@Roles("owner", "pg_operator")
export class OwnerCaptureController {
  constructor(
    @Inject(OwnerCaptureService) private readonly ownerCaptureService: OwnerCaptureService
  ) {}

  @Post("extract")
  @UseInterceptors(
    FileInterceptor("audio", {
      limits: {
        // 90s cap approximation for compressed mobile recordings.
        fileSize: 10 * 1024 * 1024
      }
    })
  )
  async extract(
    @Req() req: { user?: { id: string } },
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: 10 * 1024 * 1024 })
        .build({ fileIsRequired: true })
    )
    audio: { buffer: Buffer; mimetype: string; originalname?: string },
    @Body() body: { locale?: string; listing_type_hint?: string }
  ) {
    if (!req.user?.id) {
      throw new UnauthorizedException();
    }

    const locale = this.parseLocale(body.locale);
    const listingTypeHint = this.parseListingTypeHint(body.listing_type_hint);
    const contentType = this.resolveContentType(audio.mimetype, audio.originalname);

    return ok(
      await this.ownerCaptureService.extractFromAudio({
        audioBuffer: audio.buffer,
        contentType,
        locale,
        listingTypeHint
      })
    );
  }

  private parseLocale(raw: string | undefined): SupportedCaptureLocale {
    if (!raw) {
      return "hi-IN";
    }
    if (raw === "hi-IN" || raw === "en-IN") {
      return raw;
    }
    return "hi-IN";
  }

  private parseListingTypeHint(raw: string | undefined): ListingType | undefined {
    if (!raw) {
      return undefined;
    }
    if (raw === "flat_house" || raw === "pg") {
      return raw;
    }
    return undefined;
  }

  private resolveContentType(rawMimeType: string, rawName?: string) {
    const mimeType = rawMimeType.toLowerCase();
    const name = (rawName ?? "").toLowerCase();

    if (mimeType.startsWith("audio/webm") || mimeType.startsWith("video/webm")) {
      return "audio/webm";
    }
    if (mimeType.startsWith("audio/mp4") || mimeType.startsWith("video/mp4")) {
      return "audio/mp4";
    }
    if (mimeType === "application/octet-stream") {
      if (name.endsWith(".mp4") || name.endsWith(".m4a")) {
        return "audio/mp4";
      }
      if (name.endsWith(".webm")) {
        return "audio/webm";
      }
      return "audio/webm";
    }

    throw new BadRequestException({
      code: "invalid_audio_format",
      message: "Audio must be webm or mp4"
    });
  }
}
