import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  NotFoundException,
  ForbiddenException
} from "@nestjs/common";
import { VoiceAgentSessionService } from "./voice-agent-session.service";
import { RealtimeSessionService } from "./realtime-session.service";
import { readFeatureFlags } from "../../config/feature-flags";

/* ──────────────────────────────────────────────────────────────────────
 * VoiceAgentController
 *
 * REST endpoints for:
 *   1. Legacy session recovery (polling partial drafts).
 *   2. The new Azure OpenAI Realtime concierge — proxying the full
 *      WebRTC handshake (SDP offer → answer) so the browser never
 *      needs to talk to Azure directly (avoids CORS restrictions).
 * ──────────────────────────────────────────────────────────────────── */

interface RealtimeConnectBody {
  sdp_offer: string;
  current_step?: number;
  filled_fields?: Record<string, unknown>;
  missing_fields?: string[];
  locale?: "en" | "hi";
  owner_first_name?: string;
}

@Controller("owner/listings/voice-agent")
export class VoiceAgentController {
  constructor(
    private readonly sessionSvc: VoiceAgentSessionService,
    private readonly realtimeSvc: RealtimeSessionService
  ) {}

  /** GET /v1/owner/listings/voice-agent/session/:id/status */
  @Get("session/:id/status")
  async getSessionStatus(@Param("id") sessionId: string, @Req() req: { user?: { id?: string } }) {
    this.ensureLegacyEnabled();
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
    this.ensureLegacyEnabled();
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

  /**
   * POST /v1/owner/listings/voice-agent/realtime/connect
   *
   * Proxies the WebRTC handshake on behalf of the browser:
   *   1. Mints an ephemeral Azure OpenAI token
   *   2. Forwards the browser's SDP offer to Azure's /calls endpoint
   *   3. Returns the SDP answer + session metadata
   *
   * Body:
   *   {
   *     sdp_offer: string          — the RTCPeerConnection offer SDP
   *     current_step?: 0..5
   *     filled_fields?: { ... }
   *     missing_fields?: string[]
   *     locale?: "en" | "hi"
   *     owner_first_name?: string
   *   }
   *
   * Returns:
   *   {
   *     data: {
   *       sdp_answer: string       — set this as the remote description
   *       model: string
   *       voice: string
   *       tools: ToolDefinition[]  — push via session.update on dc open
   *       locale: string
   *     }
   *   }
   */
  @Post("realtime/connect")
  async connectRealtime(
    @Body() body: RealtimeConnectBody,
    @Req() req: { user?: { id?: string; name?: string } }
  ) {
    this.ensureRealtimeEnabled();

    const userId = req.user?.id ?? "anonymous";
    const ownerFirstName = body.owner_first_name ?? req.user?.name?.split(/\s+/)[0];

    const data = await this.realtimeSvc.connect({
      userId,
      sdpOffer: body.sdp_offer ?? "",
      currentStep: typeof body.current_step === "number" ? body.current_step : 0,
      filledFields: body.filled_fields ?? {},
      missingFields: Array.isArray(body.missing_fields) ? body.missing_fields : [],
      locale: body.locale === "hi" ? "hi" : "en",
      ownerFirstName
    });

    return { data };
  }

  private ensureLegacyEnabled(): void {
    const flags = readFeatureFlags();
    if (!flags.ff_voice_agent_enabled) {
      throw new NotFoundException("Voice agent is not enabled");
    }
  }

  private ensureRealtimeEnabled(): void {
    const flags = readFeatureFlags();
    if (!flags.ff_voice_agent_realtime) {
      throw new NotFoundException("Realtime voice concierge is not enabled");
    }
    if (!this.realtimeSvc.isConfigured()) {
      throw new NotFoundException(
        "Realtime voice concierge is not configured (missing Azure OpenAI Realtime deployment)"
      );
    }
  }
}
