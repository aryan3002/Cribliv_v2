"use client";

import { io, Socket } from "socket.io-client";

/* ──────────────────────────────────────────────────────────────────────
 * PG Voice Agent Socket Client
 *
 * Singleton Socket.IO client for the /voice-agent-pg namespace.
 * Mirrors the lifecycle convention of `voice-agent-socket.ts` (Maya).
 *
 * Server-side hard limits (enforced by the gateway):
 *   • 5 min session duration
 *   • 30 s idle timeout
 *   • 40 tool calls / session
 *   • 8 messages / second rate cap
 *   • 32 KB audio chunks
 *
 * The client mirrors the 32 KB cap before emitting so we fail fast
 * instead of getting disconnected by the server.
 * ──────────────────────────────────────────────────────────────────── */

export const PG_AUDIO_CHUNK_MAX = 32_768;

export type PgServerEventName =
  | "session_ready"
  | "field_extracted"
  | "phase_changed"
  | "tool_signal"
  | "text_ack"
  | "audio_ack"
  | "session_ended"
  | "error";

export interface PgVoiceSocketHandle {
  start(opts: { locale: "en" | "hi"; pg_property_id?: string }): void;
  sendText(text: string): void;
  sendAudio(buf: ArrayBuffer | Uint8Array): void;
  end(): void;
  on(event: PgServerEventName, cb: (...args: any[]) => void): void;
  off(event: PgServerEventName, cb: (...args: any[]) => void): void;
  connect(): void;
  disconnect(): void;
  isConnected(): boolean;
}

let socket: Socket | null = null;
let handle: PgVoiceSocketHandle | null = null;

export function createPgVoiceSocket(args: {
  userId: string;
  baseUrl?: string;
}): PgVoiceSocketHandle {
  if (handle) return handle;

  const baseUrl = (
    args.baseUrl ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    process.env.API_BASE_URL ??
    "http://localhost:4000"
  ).replace(/\/v1\/?$/, "");

  socket = io(`${baseUrl}/voice-agent-pg`, {
    transports: ["websocket", "polling"],
    auth: { userId: args.userId },
    withCredentials: true,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 15000,
    autoConnect: false
  });

  handle = {
    start: (opts) => {
      socket!.emit("start_session", opts);
    },
    sendText: (text) => {
      socket!.emit("text_input", { text });
    },
    sendAudio: (buf) => {
      const size = buf instanceof ArrayBuffer ? buf.byteLength : (buf as Uint8Array).byteLength;
      if (size > PG_AUDIO_CHUNK_MAX) {
        throw new Error(`audio chunk > ${PG_AUDIO_CHUNK_MAX} bytes`);
      }
      socket!.emit("audio_chunk", buf);
    },
    end: () => {
      socket!.emit("end_session");
    },
    on: (e, cb) => {
      socket!.on(e, cb);
    },
    off: (e, cb) => {
      socket!.off(e, cb);
    },
    connect: () => {
      socket!.connect();
    },
    disconnect: () => {
      socket!.disconnect();
    },
    isConnected: () => !!socket?.connected
  };

  return handle;
}

export function disconnectPgVoiceSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
    handle = null;
  }
}
