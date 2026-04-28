/* ──────────────────────────────────────────────────────────────────────
 * realtime-client.ts
 *
 * Browser-side WebRTC client for the Azure OpenAI Realtime concierge
 * ("Maya"). Manages:
 *
 *   1. Asking our backend (`/owner/listings/voice-agent/realtime/session`)
 *      for an ephemeral key + WebRTC URL.
 *   2. Opening a peer connection directly to Azure with that key.
 *   3. Capturing the mic, piping it as an outbound audio track.
 *   4. Receiving Maya's audio track and routing it to a hidden <audio>.
 *   5. Driving two AnalyserNodes (mic + remote) so the orb can pulse.
 *   6. Parsing data-channel events into typed callbacks:
 *        onTranscript("user" | "assistant", text)
 *        onToolCall(name, args)
 *        onState("connecting" | "listening" | "thinking" | "speaking")
 *        onAudioLevel("user" | "assistant", rms 0..1)
 *        onError(message)
 *
 * No state is stored globally — each `RealtimeClient` instance owns its
 * own peer connection, mic stream, and audio contexts. Always call
 * `stop()` on unmount.
 * ──────────────────────────────────────────────────────────────────── */

import { fetchApi, ApiError } from "./api";

export type RealtimeRole = "user" | "assistant";
export type RealtimeAgentState =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "ended"
  | "error";

export interface RealtimeConnectResponse {
  sdp_answer: string;
  model: string;
  voice: string;
  tools: unknown[];
  locale: string;
}

export interface RealtimeClientCallbacks {
  onState?: (state: RealtimeAgentState) => void;
  onTranscript?: (role: RealtimeRole, text: string, isFinal: boolean) => void;
  onToolCall?: (name: string, args: Record<string, unknown>, callId: string) => void;
  /** rms is 0..1; emitted at ~30 fps from RAF while audio is flowing */
  onAudioLevel?: (role: RealtimeRole, rms: number) => void;
  onError?: (message: string) => void;
  onSessionUpdated?: (info: { model: string; voice: string }) => void;
}

export interface RealtimeClientOptions {
  accessToken: string;
  currentStep: number;
  filledFields: Record<string, unknown>;
  missingFields: string[];
  locale: "en" | "hi";
  ownerFirstName?: string;
}

interface ConnectResponse {
  sdp_answer: string;
  model: string;
  voice: string;
  tools: unknown[];
  locale: string;
}

/* ─── Realtime API event helpers (only the bits we send) ─────────── */

interface ConversationItemCreate {
  type: "conversation.item.create";
  item: {
    type: "message";
    role: "user";
    content: Array<{ type: "input_text"; text: string }>;
  };
}

interface ResponseCreate {
  type: "response.create";
  response?: { modalities?: ("audio" | "text")[]; instructions?: string };
}

interface ToolOutputItem {
  type: "conversation.item.create";
  item: {
    type: "function_call_output";
    call_id: string;
    output: string;
  };
}

interface SessionUpdate {
  type: "session.update";
  session: Record<string, unknown>;
}

type ClientEvent =
  | ConversationItemCreate
  | ResponseCreate
  | ToolOutputItem
  | SessionUpdate
  | { type: "response.cancel" }
  | { type: "input_audio_buffer.clear" };

/* ──────────────────────────────────────────────────────────────────── */

export class RealtimeClient {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private mic: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;

  private inboundAudioCtx: AudioContext | null = null;
  private outboundAudioCtx: AudioContext | null = null;
  private inboundAnalyser: AnalyserNode | null = null;
  private outboundAnalyser: AnalyserNode | null = null;
  private rafToken: number | null = null;

  private currentState: RealtimeAgentState = "idle";
  private partialAssistant = "";
  private partialUser = "";
  private toolArgBuffers = new Map<string, string>();
  private stopped = false;
  private greetingSent = false;
  private responseInProgress = false;

  constructor(
    private readonly opts: RealtimeClientOptions,
    private readonly cb: RealtimeClientCallbacks
  ) {}

  /* ────── Public API ─────────────────────────────────────────────── */

  async start(): Promise<void> {
    if (this.stopped) return;
    this.setState("connecting");

    /* ── 1. Peer connection + remote audio sink ── */
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    this.pc = pc;

    const audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    audioEl.style.display = "none";
    document.body.appendChild(audioEl);
    this.audioEl = audioEl;

    pc.ontrack = (event) => {
      if (event.streams[0]) {
        audioEl.srcObject = event.streams[0];
        this.attachInboundAnalyser(event.streams[0]);
      }
    };

    pc.onconnectionstatechange = () => {
      if (!this.pc) return;
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        this.fail("Voice connection lost. Please try again.");
      }
    };

    /* ── 2. Mic ── */
    let mic: MediaStream;
    try {
      mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
    } catch (err) {
      this.fail("Microphone permission denied. You can still type — the form works without voice.");
      throw err;
    }
    this.mic = mic;
    const track = mic.getAudioTracks()[0];
    if (track) pc.addTrack(track, mic);
    this.attachOutboundAnalyser(mic);

    /* ── 3. Data channel (set up before remote description) ── */
    const dc = pc.createDataChannel("oai-events");
    this.dc = dc;

    // These are populated from the /connect response before the dc opens.
    let sessionTools: unknown[] = [];
    let sessionLocale = "en";

    dc.addEventListener("open", () => {
      // Push full session config over the data channel.
      // Azure's client_secrets endpoint only accepts type/model/instructions/voice;
      // tools, VAD, and transcription must be configured here.
      // Do NOT send response.create here — wait for "session.updated" confirmation
      // so tools are registered before Maya tries to use them.
      this.send({
        type: "session.update",
        session: {
          type: "realtime",
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
              transcription: {
                model: "whisper-1",
                language: sessionLocale === "hi" ? "hi" : "en"
              },
              turn_detection: {
                type: "server_vad",
                threshold: 0.55,
                prefix_padding_ms: 250,
                silence_duration_ms: 380,
                create_response: true,
                interrupt_response: true
              }
            }
          },
          tools: sessionTools,
          tool_choice: "auto"
        }
      });
      this.setState("listening");
      // Fallback: if Azure doesn't send session.updated within 2.5s, fire greeting anyway
      setTimeout(() => {
        if (!this.greetingSent && !this.stopped) {
          this.greetingSent = true;
          this.send({ type: "response.create" });
        }
      }, 2500);
    });
    dc.addEventListener("message", (event) => {
      try {
        const evt = JSON.parse(event.data as string);
        this.handleServerEvent(evt);
      } catch {
        /* ignore non-JSON */
      }
    });
    dc.addEventListener("close", () => {
      if (!this.stopped) this.setState("ended");
    });

    /* ── 4. Create SDP offer ── */
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    if (this.stopped) return;

    /* ── 5. Proxy the SDP offer through our backend to avoid CORS ── */
    let connectData!: ConnectResponse;
    try {
      connectData = await fetchApi<ConnectResponse>(
        "/owner/listings/voice-agent/realtime/connect",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${this.opts.accessToken}` },
          body: JSON.stringify({
            sdp_offer: offer.sdp ?? "",
            current_step: this.opts.currentStep,
            filled_fields: this.opts.filledFields,
            missing_fields: this.opts.missingFields,
            locale: this.opts.locale,
            owner_first_name: this.opts.ownerFirstName
          })
        }
      );
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to start the voice concierge.";
      this.fail(msg);
      throw err;
    }

    if (this.stopped) return;

    // Populate closure vars before setRemoteDescription triggers dc.open
    sessionTools = connectData.tools;
    sessionLocale = connectData.locale;
    this.cb.onSessionUpdated?.({ model: connectData.model, voice: connectData.voice });

    /* ── 6. Set remote description — WebRTC connection is established ── */
    await pc.setRemoteDescription({ type: "answer", sdp: connectData.sdp_answer });
  }

  /** Send a text message into the conversation (text-fallback path). */
  sendText(text: string): void {
    if (!text.trim() || !this.dc || this.dc.readyState !== "open") return;
    this.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: text.trim() }]
      }
    });
    this.send({ type: "response.create" });
  }

  /** Send back the result of a tool call so Maya can continue talking. */
  sendToolOutput(callId: string, output: unknown): void {
    if (!this.dc || this.dc.readyState !== "open") return;
    this.send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: typeof output === "string" ? output : JSON.stringify(output)
      }
    });
    this.send({ type: "response.create" });
  }

  /** Cancel any in-flight Maya response (barge-in). */
  interrupt(): void {
    if (!this.dc || this.dc.readyState !== "open") return;
    this.send({ type: "response.cancel" });
    this.send({ type: "input_audio_buffer.clear" });
  }

  /** Push fresh form context mid-session (when user manually edits a field). */
  pushContext(filledFields: Record<string, unknown>, currentStep: number): void {
    if (!this.dc || this.dc.readyState !== "open") return;
    this.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: `[system context — do not respond to this directly] The owner just edited the form manually. Updated state — current step ${currentStep}, filled: ${JSON.stringify(filledFields)}. Continue naturally.`
          }
        ]
      }
    });
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.setState("ended");
    if (this.rafToken != null) cancelAnimationFrame(this.rafToken);
    this.rafToken = null;
    try {
      this.dc?.close();
    } catch {
      /* ignore */
    }
    this.dc = null;
    try {
      this.pc?.getSenders().forEach((s) => {
        try {
          s.track?.stop();
        } catch {
          /* ignore */
        }
      });
      this.pc?.close();
    } catch {
      /* ignore */
    }
    this.pc = null;
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
    if (this.audioEl) {
      this.audioEl.srcObject = null;
      this.audioEl.remove();
      this.audioEl = null;
    }
    void this.inboundAudioCtx?.close().catch(() => undefined);
    void this.outboundAudioCtx?.close().catch(() => undefined);
    this.inboundAudioCtx = null;
    this.outboundAudioCtx = null;
    this.inboundAnalyser = null;
    this.outboundAnalyser = null;
  }

  /* ────── Internals ──────────────────────────────────────────────── */

  private send(evt: ClientEvent): void {
    if (this.dc && this.dc.readyState === "open") {
      this.dc.send(JSON.stringify(evt));
    }
  }

  private setState(state: RealtimeAgentState) {
    if (this.currentState === state) return;
    this.currentState = state;
    this.cb.onState?.(state);
  }

  private fail(message: string) {
    this.setState("error");
    this.cb.onError?.(message);
  }

  /**
   * Server events from Azure OpenAI Realtime over the data channel.
   * We only handle the events we need; everything else is ignored.
   *
   * Events documented at:
   *   https://platform.openai.com/docs/api-reference/realtime-server-events
   */
  private handleServerEvent(evt: { type?: string } & Record<string, unknown>) {
    // TEMP DEBUG: log every server event so we can see what Azure sends
    if (
      evt.type &&
      evt.type !== "response.output_audio.delta" &&
      evt.type !== "response.output_audio_transcript.delta"
    ) {
      // eslint-disable-next-line no-console
      console.log("[Maya event]", evt.type, evt);
    }
    switch (evt.type) {
      // Azure confirms our session.update was applied — tools are now registered.
      // Fire the greeting here so Maya has access to her tools from the first word.
      case "session.updated":
        if (!this.greetingSent && !this.responseInProgress) {
          this.greetingSent = true;
          this.responseInProgress = true;
          this.send({ type: "response.create" });
        }
        break;
      case "input_audio_buffer.speech_started":
        this.setState("listening");
        break;
      case "input_audio_buffer.speech_stopped":
        this.setState("thinking");
        break;
      case "output_audio_buffer.started":
      case "response.output_audio.delta":
        this.setState("speaking");
        break;
      case "output_audio_buffer.stopped":
      case "response.output_audio.done":
      case "response.done":
        this.setState("listening");
        this.responseInProgress = false;
        break;
      case "response.audio_transcript.delta":
      case "response.output_audio_transcript.delta": {
        const delta = String(evt.delta ?? "");
        this.partialAssistant += delta;
        this.cb.onTranscript?.("assistant", this.partialAssistant, false);
        break;
      }
      case "response.audio_transcript.done":
      case "response.output_audio_transcript.done": {
        const text = String(evt.transcript ?? this.partialAssistant);
        this.cb.onTranscript?.("assistant", text, true);
        this.partialAssistant = "";
        break;
      }
      case "conversation.item.input_audio_transcription.delta": {
        const delta = String(evt.delta ?? "");
        this.partialUser += delta;
        this.cb.onTranscript?.("user", this.partialUser, false);
        break;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const text = String(evt.transcript ?? this.partialUser);
        this.cb.onTranscript?.("user", text, true);
        this.partialUser = "";
        break;
      }

      /* ── Tool / function calls ─────────────────────────────────── */
      case "response.function_call_arguments.delta": {
        const callId = String(evt.call_id ?? evt.tool_call_id ?? "");
        if (!callId) break;
        const prev = this.toolArgBuffers.get(callId) ?? "";
        this.toolArgBuffers.set(callId, prev + String(evt.delta ?? ""));
        break;
      }
      case "response.function_call_arguments.done": {
        const callId = String(evt.call_id ?? evt.tool_call_id ?? "");
        const name = String(evt.name ?? "");
        const argsRaw =
          (this.toolArgBuffers.get(callId) ?? "") ||
          (typeof evt.arguments === "string" ? (evt.arguments as string) : "");
        this.toolArgBuffers.delete(callId);
        let args: Record<string, unknown> = {};
        try {
          args = argsRaw ? (JSON.parse(argsRaw) as Record<string, unknown>) : {};
        } catch {
          args = {};
        }
        if (name && callId) this.cb.onToolCall?.(name, args, callId);
        break;
      }
      case "response.output_item.done": {
        // Some SDK builds only emit the full function_call here.
        const item = evt.item as
          | { type?: string; name?: string; call_id?: string; arguments?: string }
          | undefined;
        if (item?.type === "function_call" && item.name && item.call_id) {
          let args: Record<string, unknown> = {};
          try {
            args = item.arguments ? (JSON.parse(item.arguments) as Record<string, unknown>) : {};
          } catch {
            args = {};
          }
          this.cb.onToolCall?.(item.name, args, item.call_id);
        }
        break;
      }
      case "error": {
        const errObj = evt.error as { message?: string; code?: string } | undefined;
        const errMsg =
          errObj?.message ?? (evt.message as string | undefined) ?? "Voice service error";
        // Non-fatal: unknown params (config mismatch) or duplicate response (race condition)
        const isNonFatal =
          errMsg.includes("Unknown parameter") ||
          errMsg.includes("unknown_parameter") ||
          errMsg.includes("active response in progress") ||
          errMsg.includes("Invalid value");
        if (!isNonFatal) {
          this.fail(String(errMsg));
        }
        break;
      }
      case "session.error": {
        const message =
          ((evt.error as { message?: string } | undefined)?.message ??
            (evt.message as string | undefined)) ||
          "Voice service error";
        this.fail(String(message));
        break;
      }
      default:
        break;
    }
  }

  /* ────── Audio level meters (drive the voice orb) ───────────────── */

  private attachOutboundAnalyser(stream: MediaStream) {
    try {
      const ctx = new AudioContext();
      this.outboundAudioCtx = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      this.outboundAnalyser = analyser;
      this.startRafLoop();
    } catch {
      /* AudioContext unavailable — orb just sits still */
    }
  }

  private attachInboundAnalyser(stream: MediaStream) {
    try {
      const ctx = new AudioContext();
      this.inboundAudioCtx = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      this.inboundAnalyser = analyser;
      this.startRafLoop();
    } catch {
      /* ignore */
    }
  }

  private startRafLoop() {
    if (this.rafToken != null) return;
    const buffer = new Uint8Array(256);
    const tick = () => {
      if (this.stopped) return;
      if (this.outboundAnalyser) {
        this.outboundAnalyser.getByteTimeDomainData(buffer);
        this.cb.onAudioLevel?.("user", computeRms(buffer));
      }
      if (this.inboundAnalyser) {
        this.inboundAnalyser.getByteTimeDomainData(buffer);
        this.cb.onAudioLevel?.("assistant", computeRms(buffer));
      }
      this.rafToken = requestAnimationFrame(tick);
    };
    this.rafToken = requestAnimationFrame(tick);
  }
}

/** Convert byte time-domain samples (centred at 128) to a 0..1 RMS. */
function computeRms(buffer: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const v = (buffer[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / buffer.length);
  // Lift small values so the orb feels responsive.
  return Math.min(1, Math.pow(rms, 0.6) * 1.25);
}

/** Quick capability probe used by the page to fall back gracefully. */
export function isRealtimeSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    typeof RTCPeerConnection !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}
