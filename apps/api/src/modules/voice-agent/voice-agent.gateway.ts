import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody
} from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import { randomUUID } from "crypto";

/** Regex for UUID v4 format */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import { readFeatureFlags } from "../../config/feature-flags";
import { VoiceAgentSessionService, type SessionRow } from "./voice-agent-session.service";
import { StreamingSTTService } from "./streaming-stt.service";
import { StreamingTTSService } from "./streaming-tts.service";
import { ConversationOrchestratorService } from "./conversation-orchestrator.service";
import type { VoiceAgentPhase, ConversationTurn } from "@cribliv/shared-types";

/* ──────────────────────────────────────────────────────────────────────
 * VoiceAgentGateway
 *
 * Socket.IO WebSocket gateway at /voice-agent namespace.
 * Handles real-time bidirectional audio streaming between the browser
 * and the conversational Hindi voice agent.
 *
 * Flow per session:
 *   client → start_session        → server creates session, sends greeting audio
 *   client → audio_chunk (binary) → server feeds STT, on recognition →
 *            LLM orchestrator → TTS → agent_audio back to client
 *   client → interrupt            → cancel TTS mid-utterance
 *   client → text_input           → fallback text path (same orchestrator)
 *   client → end_session          → finalize & return draft
 * ──────────────────────────────────────────────────────────────────── */

/** Map socket id → active session id */
const socketToSession = new Map<string, string>();

@WebSocketGateway({
  namespace: "/voice-agent",
  cors: {
    origin: (process.env.CORS_ALLOWED_ORIGINS || "http://localhost:3000,http://localhost:3001")
      .split(",")
      .map((o) => o.trim()),
    credentials: true
  },
  transports: ["websocket", "polling"]
})
export class VoiceAgentGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(VoiceAgentGateway.name);

  constructor(
    private readonly sessionSvc: VoiceAgentSessionService,
    private readonly sttSvc: StreamingSTTService,
    private readonly ttsSvc: StreamingTTSService,
    private readonly orchestrator: ConversationOrchestratorService
  ) {}

  /* ────── Connection lifecycle ────────────────────────────────────── */

  handleConnection(client: Socket): void {
    const flags = readFeatureFlags();
    if (!flags.ff_voice_agent_enabled) {
      this.logger.warn(`Voice agent disabled — rejecting ${client.id}`);
      client.emit("error", {
        code: "voice_agent_disabled",
        message: "Voice agent is not enabled",
        recoverable: false
      });
      client.disconnect(true);
      return;
    }
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    const sessionId = socketToSession.get(client.id);
    if (sessionId) {
      this.logger.log(`Client disconnected: ${client.id} — abandoning session ${sessionId}`);
      this.cleanupSession(client.id, sessionId, "abandoned").catch(() => {});
    }
  }

  /* ────── Start Session ──────────────────────────────────────────── */

  @SubscribeMessage("start_session")
  async handleStartSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { locale?: "hi-IN" | "en-IN"; listing_type_hint?: "flat_house" | "pg" }
  ): Promise<void> {
    try {
      // Extract user ID from handshake auth (JWT token parsed by middleware)
      const rawUserId = this.extractUserId(client);
      if (!rawUserId) {
        client.emit("error", {
          code: "auth_required",
          message: "Authentication required",
          recoverable: false
        });
        return;
      }

      // If userId is not a valid UUID (e.g. "anonymous" in dev), generate one
      // so the DB uuid column constraint is satisfied.
      const userId = UUID_RE.test(rawUserId) ? rawUserId : randomUUID();

      // Create session
      const session = await this.sessionSvc.create(userId);
      socketToSession.set(client.id, session.id);

      // Start STT stream
      const locale = payload.locale ?? "hi-IN";
      this.sttSvc.createSession(session.id, locale);

      // Wire STT events to orchestrator pipeline
      this.wireSTTEvents(client, session.id, locale);

      // Emit session started
      client.emit("session_started", {
        session_id: session.id,
        phase: "greeting" as VoiceAgentPhase
      });

      client.emit("state_change", { state: "greeting" });

      // Generate and send greeting
      const greetingText = this.orchestrator.getGreeting(payload.listing_type_hint);
      await this.synthesizeAndSend(client, session.id, greetingText, "greeting");

      // Update session with greeting turn
      const greetingTurn: ConversationTurn = {
        role: "agent",
        text: greetingText,
        timestamp: new Date().toISOString()
      };

      await this.sessionSvc.update(session.id, {
        conversation_turns: [greetingTurn],
        turn_count: 1,
        current_phase: payload.listing_type_hint ? "location" : "property_type"
      });

      // If listing type hint was provided, pre-fill it
      if (payload.listing_type_hint) {
        await this.sessionSvc.update(session.id, {
          partial_draft: { listing_type: payload.listing_type_hint },
          fields_collected: ["listing_type"]
        });
      }

      // Now listening
      client.emit("state_change", { state: "listening" });

      this.logger.log(`Session ${session.id} started for user ${userId}`);
    } catch (err) {
      this.logger.error(`start_session error: ${err}`);
      client.emit("error", {
        code: "session_start_failed",
        message: "Failed to start voice agent session",
        recoverable: true
      });
    }
  }

  /* ────── Audio Chunk ────────────────────────────────────────────── */

  @SubscribeMessage("audio_chunk")
  handleAudioChunk(@ConnectedSocket() client: Socket, @MessageBody() data: ArrayBuffer): void {
    const sessionId = socketToSession.get(client.id);
    if (!sessionId) return;
    this.sttSvc.pushAudio(sessionId, data);
  }

  /* ────── Interrupt (barge-in) ───────────────────────────────────── */

  @SubscribeMessage("interrupt")
  handleInterrupt(@ConnectedSocket() client: Socket): void {
    const sessionId = socketToSession.get(client.id);
    if (!sessionId) return;
    this.logger.log(`[${sessionId}] Barge-in from client`);
    this.ttsSvc.cancelSynthesis(sessionId);
    client.emit("state_change", { state: "listening" });
  }

  /* ────── Text Input (fallback for accessibility) ────────────────── */

  @SubscribeMessage("text_input")
  async handleTextInput(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { text: string }
  ): Promise<void> {
    const sessionId = socketToSession.get(client.id);
    if (!sessionId || !payload.text?.trim()) return;

    await this.processUserUtterance(client, sessionId, payload.text.trim());
  }

  /* ────── End Session ────────────────────────────────────────────── */

  @SubscribeMessage("end_session")
  async handleEndSession(@ConnectedSocket() client: Socket): Promise<void> {
    const sessionId = socketToSession.get(client.id);
    if (!sessionId) return;

    const session = await this.sessionSvc.findById(sessionId);
    if (!session) return;

    // Mark complete
    await this.sessionSvc.update(sessionId, {
      status: "completed",
      current_phase: "complete"
    });

    client.emit("session_complete", {
      session_id: sessionId,
      final_draft: session.partial_draft,
      fields_collected: session.fields_collected,
      fields_remaining: session.fields_remaining,
      turn_count: session.turn_count,
      total_audio_seconds: session.total_audio_seconds
    });

    await this.cleanupSession(client.id, sessionId, "completed");
    this.logger.log(`Session ${sessionId} ended by client`);
  }

  /* ══════════════════════════════════════════════════════════════════
   *  Internal helpers
   * ══════════════════════════════════════════════════════════════════ */

  /** Wire STT recognition events to the orchestration pipeline */
  private wireSTTEvents(client: Socket, sessionId: string, _locale: string): void {
    const sttSession = this.sttSvc.getSession(sessionId);
    if (!sttSession) return;

    // Interim results — send to client for live transcript display
    sttSession.events.on("interim", (data: { text: string }) => {
      client.emit("user_transcript", { text: data.text, is_final: false });
    });

    // Final recognition — process through orchestrator
    sttSession.events.on("final", (data: { text: string; locale: string }) => {
      client.emit("user_transcript", { text: data.text, is_final: true });
      this.processUserUtterance(client, sessionId, data.text).catch((err) => {
        this.logger.error(`[${sessionId}] Orchestration error: ${err}`);
        client.emit("error", {
          code: "processing_error",
          message: "Samajhne mein problem ho gayi, dubara boliye please",
          recoverable: true
        });
        client.emit("state_change", { state: "listening" });
      });
    });

    // STT errors
    sttSession.events.on("error", (err: { code: string; details: string }) => {
      this.logger.error(`[${sessionId}] STT error: ${err.code} — ${err.details}`);
      client.emit("error", {
        code: "stt_error",
        message: "Aapki awaaz sunaai nahi di, dubara try kariye",
        recoverable: true
      });
    });
  }

  /** Process user's spoken/typed text through the orchestrator */
  private async processUserUtterance(
    client: Socket,
    sessionId: string,
    text: string
  ): Promise<void> {
    client.emit("state_change", { state: "thinking" });

    const session = await this.sessionSvc.findById(sessionId);
    if (!session || session.status !== "active") return;

    // Add user turn
    const userTurn: ConversationTurn = {
      role: "user",
      text,
      timestamp: new Date().toISOString()
    };
    const turns = [...session.conversation_turns, userTurn];

    // Process through orchestrator
    const result = await this.orchestrator.processTurn({
      userText: text,
      currentPhase: session.current_phase,
      currentDraft: session.partial_draft,
      conversationHistory: turns,
      fieldsCollected: session.fields_collected
    });

    // Add agent turn
    const agentTurn: ConversationTurn = {
      role: "agent",
      text: result.agentText,
      timestamp: new Date().toISOString(),
      extracted_fields: result.updatedDraft as unknown as Record<string, unknown>
    };
    turns.push(agentTurn);

    // Update session in DB
    await this.sessionSvc.update(sessionId, {
      current_phase: result.nextPhase,
      conversation_turns: turns,
      partial_draft: result.updatedDraft,
      fields_collected: result.fieldsCollected,
      fields_remaining: result.fieldsRemaining,
      turn_count: turns.length,
      status: result.isComplete ? "completed" : "active"
    });

    // Emit draft update to client
    client.emit("draft_update", {
      draft: result.updatedDraft,
      fields_collected: result.fieldsCollected,
      fields_remaining: result.fieldsRemaining
    });

    // Emit phase change if changed
    if (result.nextPhase !== session.current_phase) {
      client.emit("phase_change", {
        phase: result.nextPhase,
        message: result.agentText
      });
    }

    // Check if complete
    if (result.isComplete) {
      client.emit("session_complete", {
        session_id: sessionId,
        final_draft: result.updatedDraft,
        fields_collected: result.fieldsCollected,
        fields_remaining: result.fieldsRemaining,
        turn_count: turns.length,
        total_audio_seconds: session.total_audio_seconds
      });
      await this.cleanupSession(client.id, sessionId, "completed");
      return;
    }

    // Synthesize agent response and send audio
    await this.synthesizeAndSend(client, sessionId, result.agentText, result.nextPhase);

    // Back to listening
    client.emit("state_change", { state: "listening" });
  }

  /** Synthesize text to speech and send complete audio to client */
  private async synthesizeAndSend(
    client: Socket,
    sessionId: string,
    text: string,
    phase: VoiceAgentPhase
  ): Promise<void> {
    client.emit("state_change", { state: "speaking" });
    client.emit("agent_text", { text, phase });

    try {
      const ttsResult = await this.ttsSvc.synthesize(sessionId, text);

      // Send the COMPLETE MP3 as a single binary message.
      // Chunking MP3 into arbitrary 8KB slices produces invalid audio
      // fragments that cannot be decoded independently by the browser.
      // A typical Hindi sentence is 20-100KB as MP3 — well within
      // Socket.IO's default 1MB maxHttpBufferSize.
      client.emit("agent_audio", Buffer.from(ttsResult.audioData));
      client.emit("agent_audio_end", { durationMs: ttsResult.durationMs });
    } catch (err) {
      this.logger.warn(`[${sessionId}] TTS failed, text-only fallback: ${err}`);
      // Text-only fallback — agent_text was already emitted above
      client.emit("agent_audio_end", { durationMs: 0 });
    }
  }

  /** Cleanup session state */
  private async cleanupSession(
    socketId: string,
    sessionId: string,
    status: "completed" | "abandoned"
  ): Promise<void> {
    socketToSession.delete(socketId);
    await this.sttSvc.closeSession(sessionId).catch(() => {});
    this.ttsSvc.cancelSynthesis(sessionId);
    await this.sessionSvc.update(sessionId, { status }).catch(() => {});
  }

  /** Extract user ID from socket handshake auth */
  private extractUserId(client: Socket): string | null {
    // Support both JWT from auth header and direct userId for dev mode
    const auth = client.handshake.auth as { userId?: string; token?: string } | undefined;
    if (auth?.userId) return auth.userId;

    // TODO: In production, validate JWT token and extract userId
    // For now, also accept from query params for development
    const queryUserId = client.handshake.query?.userId;
    if (typeof queryUserId === "string") return queryUserId;

    return null;
  }
}
