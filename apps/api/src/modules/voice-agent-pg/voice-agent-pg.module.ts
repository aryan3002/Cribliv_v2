import { Module } from "@nestjs/common";
import { CoreModule } from "../../common/core.module";
import { VoiceAgentPgGateway } from "./voice-agent-pg.gateway";
import { PgVoiceSessionService } from "./services/pg-voice-session.service";
import { PgExtractionService } from "./services/pg-extraction.service";
import { PgConversationOrchestrator } from "./services/pg-conversation-orchestrator.service";

@Module({
  imports: [CoreModule],
  providers: [
    VoiceAgentPgGateway,
    PgVoiceSessionService,
    PgExtractionService,
    PgConversationOrchestrator
  ],
  exports: [PgVoiceSessionService, PgExtractionService, PgConversationOrchestrator]
})
export class VoiceAgentPgModule {}
