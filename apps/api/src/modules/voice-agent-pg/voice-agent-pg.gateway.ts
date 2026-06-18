import { Inject, Logger } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import type { PgVoiceToolName, VoiceAgentPgPhase } from "@cribliv/shared-types";
import { AppStateService } from "../../common/app-state.service";
import { DatabaseService } from "../../common/database.service";
import { resolveSessionUser } from "../../common/session-auth";
import { logTelemetry } from "../../common/telemetry";
import { PgVoiceSessionService } from "./services/pg-voice-session.service";
import { PgExtractionService } from "./services/pg-extraction.service";
import { PgConversationOrchestrator } from "./services/pg-conversation-orchestrator.service";
import { PgLlmClient, type LlmMessage } from "./services/pg-llm-client.service";
import { getToolByName } from "./tools/pg-realtime-tools";
import { SYSTEM_PROMPT_VERSION, buildPgSystemPrompt } from "./prompts/pg-system-prompt";

interface StartSessionPayload {
  locale?: "en" | "hi";
  pg_property_id?: string;
  /**
   * Channel the operator picked. `voice` (default) keeps existing realtime
   * behaviour. `text` enables server-driven LLM responses via Azure OpenAI
   * chat-completions (`cribliv-chat`) — see PgLlmClient.
   */
  mode?: "voice" | "text";
}

interface ToolCallPayload {
  name: PgVoiceToolName;
  input: unknown;
  pg_property_id?: string;
}

/**
 * Socket.IO gateway for the PG voice agent. Stateful per-socket session map.
 * Realtime STT/TTS wiring happens via voice-agent-core (added in T31 wiring);
 * V1 ships text_input + tool_call (LLM client adapter slots in later).
 *
 * Cost-control hard limits (V1) — "less is better" production defaults:
 *  - SESSION_MAX_MS: 5 min hard kill (was 30 → tightened)
 *  - IDLE_TIMEOUT_MS: 30s no msg (was 60 → tightened)
 *  - TOOL_CALL_CAP: 40 per session (was 100 → tightened)
 *  - MSG_RATE_PER_SEC: 8
 *  - MAX_CONCURRENT_PER_OPERATOR: 2 (was 5 → tightened)
 *  - MAX_SESSIONS_PER_OPERATOR_PER_DAY: 5 (in-memory counter, resets at process restart in V1; DB-backed in V1.5)
 *  - AUDIO_CHUNK_MAX_BYTES: 32_768
 * All terminations emit `pg_voice.session.terminated { reason }` telemetry.
 */
const SESSION_MAX_MS = 5 * 60 * 1000;
const IDLE_TIMEOUT_MS = 30 * 1000;
const TOOL_CALL_CAP = 40;
const MSG_RATE_PER_SEC = 8;
const MAX_CONCURRENT_PER_OPERATOR = 2;
const MAX_SESSIONS_PER_OPERATOR_PER_DAY = 5;
const AUDIO_CHUNK_MAX_BYTES = 32_768;

interface SessionMeta {
  durationTimer: NodeJS.Timeout;
  idleTimer: NodeJS.Timeout;
  toolCalls: number;
  rateWindowStart: number;
  rateCount: number;
  operatorUserId: string;
  mode: "voice" | "text";
  locale: "en" | "hi";
  /** In-memory LLM message history for text mode. Bounded to MAX_LLM_HISTORY entries. */
  llmHistory: LlmMessage[];
  /** Reentrancy guard so back-to-back text inputs don't interleave LLM calls. */
  llmInFlight: boolean;
}

const MAX_LLM_HISTORY = 32; // user+assistant+tool messages; system held separately
const MAX_LLM_TOOL_ROUND_TRIPS = 4;

@WebSocketGateway({ namespace: "/voice-agent-pg", cors: true })
export class VoiceAgentPgGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly log = new Logger(VoiceAgentPgGateway.name);
  private readonly socketToSession = new Map<string, string>();
  private readonly sessionDraft = new Map<string, string>(); // sessionId -> draftId
  private readonly sessionMeta = new Map<string, SessionMeta>();
  private readonly operatorConcurrent = new Map<string, Set<string>>();
  // In-memory daily counter: operatorId -> { date: 'YYYY-MM-DD', count: N }. Resets on process restart (V1).
  private readonly operatorDaily = new Map<string, { date: string; count: number }>();

  constructor(
    @Inject(PgVoiceSessionService) private readonly sessions: PgVoiceSessionService,
    @Inject(PgExtractionService) private readonly extraction: PgExtractionService,
    @Inject(PgConversationOrchestrator) private readonly orchestrator: PgConversationOrchestrator,
    @Inject(AppStateService) private readonly state: AppStateService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PgLlmClient) private readonly llm: PgLlmClient
  ) {}

  handleConnection(client: Socket): void {
    this.log.log(`pg-voice connected ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    const sid = this.socketToSession.get(client.id);
    if (sid) {
      this.cleanupSession(sid, "disconnect");
      this.socketToSession.delete(client.id);
    }
  }

  /** Tear down all timers + counters + DB end + telemetry. Idempotent. */
  private cleanupSession(sid: string, reason: string): void {
    const meta = this.sessionMeta.get(sid);
    if (meta) {
      clearTimeout(meta.durationTimer);
      clearTimeout(meta.idleTimer);
      const set = this.operatorConcurrent.get(meta.operatorUserId);
      set?.delete(sid);
      if (set && set.size === 0) this.operatorConcurrent.delete(meta.operatorUserId);
    }
    this.sessionMeta.delete(sid);
    this.sessionDraft.delete(sid);
    this.sessions
      .endSession(sid)
      .catch((e) => this.log.error(`endSession on cleanup failed: ${String(e)}`));
    logTelemetry("pg_voice.session.terminated", { sessionId: sid, reason });
  }

  private terminate(client: Socket, sid: string, reason: string): void {
    client.emit("session_ended", {
      draft_id: this.sessionDraft.get(sid) ?? null,
      listing_id: null,
      reason
    });
    this.cleanupSession(sid, reason);
    this.socketToSession.delete(client.id);
    try {
      client.disconnect(true);
    } catch {}
  }

  private resetIdle(client: Socket, sid: string): void {
    const meta = this.sessionMeta.get(sid);
    if (!meta) return;
    clearTimeout(meta.idleTimer);
    meta.idleTimer = setTimeout(() => this.terminate(client, sid, "idle_timeout"), IDLE_TIMEOUT_MS);
  }

  /** Returns true if msg should be processed; false if rate-limited (client gets error). */
  private rateAllow(sid: string, client: Socket): boolean {
    const meta = this.sessionMeta.get(sid);
    if (!meta) return false;
    const now = Date.now();
    if (now - meta.rateWindowStart >= 1000) {
      meta.rateWindowStart = now;
      meta.rateCount = 0;
    }
    meta.rateCount++;
    if (meta.rateCount > MSG_RATE_PER_SEC) {
      client.emit("error", { code: "rate_limited", message: `>${MSG_RATE_PER_SEC} msg/s` });
      return false;
    }
    return true;
  }

  @SubscribeMessage("start_session")
  async onStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: StartSessionPayload
  ): Promise<void> {
    // SEC-C2: derive the operator identity from a VERIFIED session token in the
    // handshake (`auth.token` = `acc_<sessionId>`), never from a client-supplied
    // userId. The old contract trusted `auth.userId`, letting anyone open a
    // session as any operator and write drafts/sessions/analytics on their behalf.
    const authBag = client.handshake.auth as { token?: string } | undefined;
    const authed = await resolveSessionUser(authBag?.token, this.database, this.state);
    if (!authed) {
      client.emit("error", {
        code: "unauth_handshake",
        message:
          "Voice/text session requires a signed-in PG operator. Refresh the page and try again."
      });
      logTelemetry("pg_voice.session.rejected", { reason: "unauth_handshake" });
      try {
        client.disconnect(true);
      } catch {}
      return;
    }
    if (authed.role !== "pg_operator") {
      // Parity with the HTTP /pg-operator/* controllers — only operators list PGs.
      client.emit("error", {
        code: "forbidden_role",
        message: "Only PG operators can start a listing session."
      });
      logTelemetry("pg_voice.session.rejected", { reason: "forbidden_role", role: authed.role });
      try {
        client.disconnect(true);
      } catch {}
      return;
    }
    const operatorUserId = authed.id;

    // Concurrent-session cap per operator
    const liveSet = this.operatorConcurrent.get(operatorUserId) ?? new Set<string>();
    if (liveSet.size >= MAX_CONCURRENT_PER_OPERATOR) {
      client.emit("error", {
        code: "concurrent_session_cap",
        message: `Max ${MAX_CONCURRENT_PER_OPERATOR} concurrent voice sessions per operator`
      });
      logTelemetry("pg_voice.session.rejected", {
        operatorId: operatorUserId,
        reason: "concurrent_cap"
      });
      try {
        client.disconnect(true);
      } catch {}
      return;
    }

    // Daily cap per operator (in-memory; resets on process restart for V1)
    const today = new Date().toISOString().slice(0, 10);
    const daily = this.operatorDaily.get(operatorUserId);
    if (daily?.date === today && daily.count >= MAX_SESSIONS_PER_OPERATOR_PER_DAY) {
      client.emit("error", {
        code: "daily_session_cap",
        message: `Max ${MAX_SESSIONS_PER_OPERATOR_PER_DAY} voice sessions per operator per day`
      });
      logTelemetry("pg_voice.session.rejected", {
        operatorId: operatorUserId,
        reason: "daily_cap",
        count: daily.count
      });
      try {
        client.disconnect(true);
      } catch {}
      return;
    }
    if (daily?.date === today) {
      daily.count++;
    } else {
      this.operatorDaily.set(operatorUserId, { date: today, count: 1 });
    }

    const session = await this.sessions.startSession({
      operatorUserId,
      locale: body?.locale ?? "en",
      systemPromptVersion: SYSTEM_PROMPT_VERSION
    });
    this.socketToSession.set(client.id, session.id);
    liveSet.add(session.id);
    this.operatorConcurrent.set(operatorUserId, liveSet);

    // Install hard-duration + idle timers
    const locale = (body?.locale === "hi" ? "hi" : "en") as "en" | "hi";
    const mode = (body?.mode === "text" ? "text" : "voice") as "voice" | "text";
    const meta: SessionMeta = {
      durationTimer: setTimeout(
        () => this.terminate(client, session.id, "duration_cap"),
        SESSION_MAX_MS
      ),
      idleTimer: setTimeout(
        () => this.terminate(client, session.id, "idle_timeout"),
        IDLE_TIMEOUT_MS
      ),
      toolCalls: 0,
      rateWindowStart: Date.now(),
      rateCount: 0,
      operatorUserId,
      mode,
      locale,
      llmHistory: [],
      llmInFlight: false
    };
    this.sessionMeta.set(session.id, meta);

    client.emit("session_ready", { session_id: session.id, phase: session.phase, mode });

    // Text mode: kick off a greeting from the model so the user sees something
    // even before they type. Voice mode keeps existing realtime greeting path.
    if (mode === "text") {
      // Fire-and-forget; errors are surfaced via socket emits inside runLlmTurn().
      void this.runLlmTurn(client, session.id, /* userText */ null);
    }
    logTelemetry("pg_voice.session.start", {
      sessionId: session.id,
      operatorId: operatorUserId,
      locale: body?.locale,
      mode,
      prompt_version: SYSTEM_PROMPT_VERSION
    });
  }

  @SubscribeMessage("tool_call")
  async onToolCall(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: ToolCallPayload
  ): Promise<void> {
    const sid = this.socketToSession.get(client.id);
    if (!sid) {
      client.emit("error", { code: "no_session", message: "start_session first" });
      return;
    }
    if (!this.rateAllow(sid, client)) return;
    this.resetIdle(client, sid);

    // Tool-call cap
    const meta = this.sessionMeta.get(sid);
    if (meta) {
      meta.toolCalls++;
      if (meta.toolCalls > TOOL_CALL_CAP) {
        this.terminate(client, sid, "tool_call_cap");
        return;
      }
    }

    const tool = getToolByName(body.name);
    if (!tool) {
      client.emit("error", { code: "unknown_tool", message: String(body.name) });
      return;
    }
    const session = this.sessions.getSession(sid);
    const phase: VoiceAgentPgPhase = session?.phase ?? "discovery";
    const locale = session?.locale ?? "en";
    const result = tool.handler(body.input, { sessionId: sid, phase, locale });

    if (!result.ok) {
      for (const err of result.errors) {
        logTelemetry("pg_voice.field.rejected", {
          sessionId: sid,
          field: err.field,
          reason: err.code
        });
      }
      client.emit("error", {
        code: "validation_failed",
        message: result.errors.map((e) => e.message).join("; ")
      });
      return;
    }

    if (result.extracted.length === 0) {
      // Signal-only tool (summarize_for_confirm, request_photo_upload) — broadcast intent.
      client.emit("tool_signal", { name: body.name });
      return;
    }

    const draftId = await this.extraction.commitExtraction({
      operatorUserId: session?.operator_user_id ?? "anon-test",
      pgPropertyId: body.pg_property_id ?? this.sessionDraft.get(sid) ?? "prop-tmp",
      draftId: this.sessionDraft.get(sid),
      toolName: body.name,
      extracted: result.extracted
    });
    this.sessionDraft.set(sid, draftId);

    for (const e of result.extracted) {
      client.emit("field_extracted", {
        field: e.field,
        value: e.value,
        confidence: e.confidence,
        draft_id: draftId
      });
      await this.sessions.logExtraction(sid, {
        field: e.field,
        value: e.value,
        confidence: e.confidence,
        tool: body.name,
        phase,
        ts: new Date().toISOString()
      });
      logTelemetry("pg_voice.field.extracted", {
        sessionId: sid,
        field: e.field,
        confidence: e.confidence,
        tool: body.name
      });
    }

    const draft = this.state.getPgListingDraft(draftId) as {
      payload: Record<string, unknown>;
    } | null;
    const draftPayload = draft?.payload ?? {};
    const newPhase = this.orchestrator.computeNextPhase(phase, draftPayload as never);
    if (newPhase !== phase) {
      await this.sessions.updatePhase(sid, newPhase);
      client.emit("phase_changed", { from: phase, to: newPhase });
      logTelemetry("pg_voice.phase.changed", { sessionId: sid, from: phase, to: newPhase });
    }
  }

  @SubscribeMessage("text_input")
  async onTextInput(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { text: string }
  ): Promise<void> {
    const sid = this.socketToSession.get(client.id);
    if (!sid) {
      client.emit("error", { code: "no_session", message: "start_session first" });
      return;
    }
    if (!this.rateAllow(sid, client)) return;
    this.resetIdle(client, sid);

    const userText = String(body?.text ?? "").trim();
    if (!userText) return;

    await this.sessions.appendTranscript(sid, {
      role: "user",
      text: userText,
      ts: new Date().toISOString()
    });
    client.emit("text_ack", { received: true });

    const meta = this.sessionMeta.get(sid);
    if (meta?.mode === "text") {
      // Drive the LLM. Errors surface as `error` socket events from inside.
      await this.runLlmTurn(client, sid, userText);
    }
  }

  /**
   * Run one user→LLM round-trip in text mode. Loops while the model proposes
   * tool calls (bounded by MAX_LLM_TOOL_ROUND_TRIPS) so a single user message
   * can trigger several internal tool executions before the final text reply.
   *
   * `userText === null` means: open the session with a greeting (no user msg).
   */
  private async runLlmTurn(client: Socket, sid: string, userText: string | null): Promise<void> {
    const meta = this.sessionMeta.get(sid);
    if (!meta) return;
    if (meta.llmInFlight) {
      client.emit("error", { code: "llm_busy", message: "Previous reply still streaming" });
      return;
    }
    meta.llmInFlight = true;

    try {
      const system: LlmMessage = {
        role: "system",
        content: buildPgSystemPrompt({ locale: meta.locale })
      };
      if (userText) {
        meta.llmHistory.push({ role: "user", content: userText });
      } else if (meta.llmHistory.length === 0) {
        // Seed a synthetic kick so the model produces a greeting question.
        meta.llmHistory.push({ role: "user", content: "[BEGIN]" });
      }

      // Trim history to bound prompt growth.
      if (meta.llmHistory.length > MAX_LLM_HISTORY) {
        meta.llmHistory.splice(0, meta.llmHistory.length - MAX_LLM_HISTORY);
      }

      let assistantText = "";
      for (let round = 0; round < MAX_LLM_TOOL_ROUND_TRIPS; round++) {
        client.emit("assistant_thinking", { round });

        const turn = await this.llm.requestTurn({
          messages: [system, ...meta.llmHistory],
          locale: meta.locale
        });

        // Record the assistant turn (with tool_calls if any) before executing them.
        meta.llmHistory.push({
          role: "assistant",
          content: turn.finalText || null,
          tool_calls: turn.toolCalls.length
            ? turn.toolCalls.map((c) => ({
                id: c.id,
                type: "function" as const,
                function: { name: c.name, arguments: c.rawArgs }
              }))
            : undefined
        });

        if (turn.finalText) {
          assistantText = turn.finalText;
        }

        if (turn.toolCalls.length === 0) {
          break;
        }

        // Execute each tool through the same path tool_call uses, append the
        // result, and loop the LLM so it can continue.
        for (const tc of turn.toolCalls) {
          meta.toolCalls++;
          if (meta.toolCalls > TOOL_CALL_CAP) {
            this.terminate(client, sid, "tool_call_cap");
            return;
          }
          const execResult = await this.executeToolByName(client, sid, tc.name, tc.args);
          meta.llmHistory.push({
            role: "tool",
            tool_call_id: tc.id,
            name: tc.name,
            content: JSON.stringify(execResult)
          });
        }
      }

      if (assistantText) {
        // TranscriptEntry uses "agent" for the assistant role; the LLM message
        // history above uses "assistant" (OpenAI vocabulary). Different model,
        // different naming — both legitimate, mapped here.
        await this.sessions.appendTranscript(sid, {
          role: "agent",
          text: assistantText,
          ts: new Date().toISOString()
        });
        client.emit("assistant_text", { text: assistantText });
      } else {
        // Loop exhausted without a final text — surface so the UI doesn't hang.
        client.emit("assistant_text", {
          text: "(I'm working on this — try giving me one more detail.)"
        });
      }
    } catch (err) {
      const code =
        err && typeof err === "object" && "response" in err
          ? "pg_llm_failed"
          : ((err as { code?: string })?.code ?? "pg_llm_failed");
      const message = (err as Error)?.message ?? "LLM error";
      client.emit("error", { code, message });
      this.log.error(`runLlmTurn failed for ${sid}: ${String(err)}`);
    } finally {
      meta.llmInFlight = false;
    }
  }

  /**
   * Internal tool-runner used by the LLM path. Mirrors the side-effects of the
   * `tool_call` socket handler (extraction commit, field_extracted emits, phase
   * advance) so voice and text modes converge on the same downstream state.
   * Returns a small object the LLM can read back as the tool's "output".
   */
  private async executeToolByName(
    client: Socket,
    sid: string,
    name: string,
    rawArgs: unknown
  ): Promise<{ ok: boolean; extracted?: number; errors?: string[] }> {
    const tool = getToolByName(name as PgVoiceToolName);
    if (!tool) {
      client.emit("error", { code: "unknown_tool", message: name });
      return { ok: false, errors: [`unknown tool: ${name}`] };
    }
    const session = this.sessions.getSession(sid);
    const phase: VoiceAgentPgPhase = session?.phase ?? "discovery";
    const locale = session?.locale ?? "en";
    const result = tool.handler(rawArgs, { sessionId: sid, phase, locale });

    if (!result.ok) {
      for (const err of result.errors) {
        logTelemetry("pg_voice.field.rejected", {
          sessionId: sid,
          field: err.field,
          reason: err.code
        });
      }
      return { ok: false, errors: result.errors.map((e) => e.message) };
    }

    if (result.extracted.length === 0) {
      client.emit("tool_signal", { name });
      return { ok: true, extracted: 0 };
    }

    const draftId = await this.extraction.commitExtraction({
      operatorUserId: session?.operator_user_id ?? "anon-test",
      pgPropertyId: this.sessionDraft.get(sid) ?? "prop-tmp",
      draftId: this.sessionDraft.get(sid),
      toolName: name as PgVoiceToolName,
      extracted: result.extracted
    });
    this.sessionDraft.set(sid, draftId);

    for (const e of result.extracted) {
      client.emit("field_extracted", {
        field: e.field,
        value: e.value,
        confidence: e.confidence,
        draft_id: draftId
      });
      await this.sessions.logExtraction(sid, {
        field: e.field,
        value: e.value,
        confidence: e.confidence,
        tool: name as PgVoiceToolName,
        phase,
        ts: new Date().toISOString()
      });
      logTelemetry("pg_voice.field.extracted", {
        sessionId: sid,
        field: e.field,
        confidence: e.confidence,
        tool: name
      });
    }

    const draft = this.state.getPgListingDraft(draftId) as {
      payload: Record<string, unknown>;
    } | null;
    const draftPayload = draft?.payload ?? {};
    const newPhase = this.orchestrator.computeNextPhase(phase, draftPayload as never);
    if (newPhase !== phase) {
      await this.sessions.updatePhase(sid, newPhase);
      client.emit("phase_changed", { from: phase, to: newPhase });
      logTelemetry("pg_voice.phase.changed", { sessionId: sid, from: phase, to: newPhase });
    }

    return { ok: true, extracted: result.extracted.length };
  }

  @SubscribeMessage("audio_chunk")
  async onAudioChunk(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: ArrayBuffer | Buffer
  ): Promise<void> {
    const sid = this.socketToSession.get(client.id);
    if (!sid) {
      client.emit("error", { code: "no_session", message: "start_session first" });
      return;
    }
    const size = body instanceof Buffer ? body.byteLength : (body?.byteLength ?? 0);
    if (size > AUDIO_CHUNK_MAX_BYTES) {
      client.emit("error", {
        code: "audio_chunk_too_large",
        message: `chunk ${size}B > ${AUDIO_CHUNK_MAX_BYTES}B`
      });
      return;
    }
    if (!this.rateAllow(sid, client)) return;
    this.resetIdle(client, sid);
    // V1 ships gateway path only — STT wire-in lands when voice-agent-core extracts.
    client.emit("audio_ack", { bytes: size });
  }

  @SubscribeMessage("end_session")
  async onEnd(@ConnectedSocket() client: Socket): Promise<void> {
    const sid = this.socketToSession.get(client.id);
    if (!sid) return;
    const draftId = this.sessionDraft.get(sid) ?? null;
    this.cleanupSession(sid, "user_end");
    this.socketToSession.delete(client.id);
    client.emit("session_ended", { draft_id: draftId, listing_id: null, reason: "user_end" });
    logTelemetry("pg_voice.session.end", { sessionId: sid });
  }
}
