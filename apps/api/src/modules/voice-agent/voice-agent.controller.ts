import { Controller, Get, Param, Req, NotFoundException, ForbiddenException } from "@nestjs/common";
import { VoiceAgentSessionService } from "./voice-agent-session.service";
import { readFeatureFlags } from "../../config/feature-flags";

/* ──────────────────────────────────────────────────────────────────────
 * VoiceAgentController
 *
 * REST endpoints for voice agent session recovery / status checking.
 * Used when WebSocket disconnects — frontend can poll or fetch the
 * partial draft from a session.
 * ──────────────────────────────────────────────────────────────────── */

@Controller("v1/owner/listings/voice-agent")
export class VoiceAgentController {
  constructor(private readonly sessionSvc: VoiceAgentSessionService) {}

  /** GET /v1/owner/listings/voice-agent/session/:id/status */
  @Get("session/:id/status")
  async getSessionStatus(@Param("id") sessionId: string, @Req() req: { user?: { id?: string } }) {
    this.ensureEnabled();
    const session = await this.sessionSvc.findById(sessionId);
    if (!session) throw new NotFoundException("Session not found");
    if (req.user?.id && session.user_id !== req.user.id) {
      throw new ForbiddenException("Not your session");
    }
    return { data: this.sessionSvc.toResponse(session) };
  }

  /** GET /v1/owner/listings/voice-agent/session/:id/draft */
  @Get("session/:id/draft")
  async getSessionDraft(@Param("id") sessionId: string, @Req() req: { user?: { id?: string } }) {
    this.ensureEnabled();
    const session = await this.sessionSvc.findById(sessionId);
    if (!session) throw new NotFoundException("Session not found");
    if (req.user?.id && session.user_id !== req.user.id) {
      throw new ForbiddenException("Not your session");
    }
    return {
      data: {
        session_id: session.id,
        status: session.status,
        partial_draft: session.partial_draft,
        fields_collected: session.fields_collected,
        fields_remaining: session.fields_remaining
      }
    };
  }

  private ensureEnabled(): void {
    const flags = readFeatureFlags();
    if (!flags.ff_voice_agent_enabled) {
      throw new NotFoundException("Voice agent is not enabled");
    }
  }
}
