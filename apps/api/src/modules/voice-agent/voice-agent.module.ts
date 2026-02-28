import { Module } from "@nestjs/common";
import { OwnerModule } from "../owner/owner.module";
import { VoiceAgentGateway } from "./voice-agent.gateway";
import { VoiceAgentSessionService } from "./voice-agent-session.service";
import { StreamingSTTService } from "./streaming-stt.service";
import { StreamingTTSService } from "./streaming-tts.service";
import { ConversationOrchestratorService } from "./conversation-orchestrator.service";
import { VoiceAgentController } from "./voice-agent.controller";

@Module({
  imports: [OwnerModule],
  controllers: [VoiceAgentController],
  providers: [
    VoiceAgentGateway,
    VoiceAgentSessionService,
    StreamingSTTService,
    StreamingTTSService,
    ConversationOrchestratorService
  ],
  exports: [VoiceAgentSessionService]
})
export class VoiceAgentModule {}
