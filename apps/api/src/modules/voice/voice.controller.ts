import { Body, Controller, Inject, Post, Req, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ok } from "../../common/response";
import { VoiceService, VoiceLocale } from "./voice.service";
import { Request } from "express";
import "multer"; // Import for Express.Multer.File type

@Controller("voice")
export class VoiceController {
  constructor(@Inject(VoiceService) private readonly voiceService: VoiceService) {}

  /**
   * POST /voice/search
   * Accepts audio file upload + locale, returns transcription + search route result.
   *
   * Content-Type: multipart/form-data
   * Fields: audio (file), locale ("en-IN" | "hi-IN"), session_token? (string)
   */
  @Post("search")
  @UseInterceptors(
    FileInterceptor("audio", {
      limits: { fileSize: 10 * 1024 * 1024 } // 10MB max
    })
  )
  async voiceSearch(
    @UploadedFile() audio: Express.Multer.File,
    @Body() body: { locale?: string; session_token?: string },
    @Req() req: Request
  ) {
    const locale: VoiceLocale = body.locale === "hi-IN" || body.locale === "hi" ? "hi-IN" : "en-IN";

    const audioBuffer = audio?.buffer ?? Buffer.alloc(0);
    const contentType = audio?.mimetype ?? "audio/wav";

    const result = await this.voiceService.voiceSearch(
      audioBuffer,
      contentType,
      locale,
      body.session_token,
      undefined // userId could come from auth if available
    );

    return ok(result);
  }

  /**
   * POST /voice/transcribe
   * Transcribe-only endpoint (no search routing).
   */
  @Post("transcribe")
  @UseInterceptors(
    FileInterceptor("audio", {
      limits: { fileSize: 10 * 1024 * 1024 }
    })
  )
  async transcribe(@UploadedFile() audio: Express.Multer.File, @Body() body: { locale?: string }) {
    const locale: VoiceLocale = body.locale === "hi-IN" || body.locale === "hi" ? "hi-IN" : "en-IN";

    const audioBuffer = audio?.buffer ?? Buffer.alloc(0);
    const contentType = audio?.mimetype ?? "audio/wav";

    const transcription = await this.voiceService.transcribe(audioBuffer, contentType, locale);
    return ok(transcription);
  }
}
