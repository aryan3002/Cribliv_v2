import { Module } from "@nestjs/common";
import { OwnerModule } from "../owner/owner.module";
import { VoiceAgentCoreModule } from "../voice-agent-core";
import { VoiceAgentGateway } from "./voice-agent.gateway";
import { VoiceAgentSessionService } from "./voice-agent-session.service";
import { ConversationOrchestratorService } from "./conversation-orchestrator.service";
import { VoiceAgentController } from "./voice-agent.controller";

@Module({
  imports: [OwnerModule, VoiceAgentCoreModule],
  controllers: [VoiceAgentController],
  providers: [
    // Maya orchestrator + session — STT/TTS/Realtime now provided by VoiceAgentCoreModule
    VoiceAgentGateway,
    VoiceAgentSessionService,
    ConversationOrchestratorService
  ],
  exports: [VoiceAgentSessionService, VoiceAgentCoreModule]
})
export class VoiceAgentModule {}
