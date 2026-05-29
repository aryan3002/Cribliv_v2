import { Module } from "@nestjs/common";
import { RealtimeSessionService } from "./realtime-session.service";
import { StreamingSTTService } from "./streaming-stt.service";
import { StreamingTTSService } from "./streaming-tts.service";

/**
 * Shared realtime + STT + TTS infrastructure used by both:
 * - voice-agent/ (Maya — tenant search + flat_house owner draft)
 * - voice-agent-pg/ (PG operator listing capture)
 *
 * No controllers, no gateway. Pure provider module.
 * Extracted from voice-agent/ in PG Operator V1 (migration 0031 cycle).
 */
@Module({
  providers: [RealtimeSessionService, StreamingSTTService, StreamingTTSService],
  exports: [RealtimeSessionService, StreamingSTTService, StreamingTTSService]
})
export class VoiceAgentCoreModule {}
