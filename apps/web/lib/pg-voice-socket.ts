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
 *
 * Lifecycle note (2026-05-30):
 *   The handle is "self-healing" — its methods lazily (re)create the
 *   underlying Socket.IO client if a previous `disconnect()` torn it down.
 *   This avoids a crash when React 18 strict-mode dev mode double-invokes
 *   the consumer's useEffect (mount → cleanup → mount), where the cleanup
 *   nulls the singleton and the second mount would otherwise see `socket!`
 *   as null. Each method either bails (off/disconnect/end on a torn-down
 *   socket are no-ops) or re-bootstraps (connect/start/send recreate).
 * ──────────────────────────────────────────────────────────────────── */

export const PG_AUDIO_CHUNK_MAX = 32_768;

export type PgServerEventName =
  | "session_ready"
  | "field_extracted"
  | "phase_changed"
  | "tool_signal"
  | "text_ack"
  | "audio_ack"
  | "assistant_thinking"
  | "assistant_text"
  | "session_ended"
  | "error";

export interface PgVoiceSocketHandle {
  start(opts: { locale: "en" | "hi"; pg_property_id?: string; mode?: "voice" | "text" }): void;
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
let lastUserId = "anonymous";
let lastToken: string | null = null;
let lastBaseUrl: string | undefined;
// Registered listeners — we re-attach them whenever the socket is rebuilt
// so consumers don't lose subscriptions across a disconnect/reconnect cycle.
type Listener = { event: string; cb: (...args: any[]) => void };
const listeners: Listener[] = [];

function buildSocket(): Socket {
  const baseUrl = (
    lastBaseUrl ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    process.env.API_BASE_URL ??
    "http://localhost:4000"
  ).replace(/\/v1\/?$/, "");

  const s = io(`${baseUrl}/voice-agent-pg`, {
    transports: ["websocket", "polling"],
    // SEC-C2: the gateway VERIFIES `token` (a signed-in session) and ignores any
    // client-supplied userId. userId is kept only as a harmless legacy hint.
    auth: { token: lastToken ?? undefined, userId: lastUserId },
    withCredentials: true,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 15000,
    autoConnect: false
  });

  // Re-attach any listeners that were registered on a torn-down predecessor.
  for (const { event, cb } of listeners) {
    s.on(event, cb);
  }
  return s;
}

function ensureSocket(): Socket {
  if (!socket) socket = buildSocket();
  return socket;
}

export function createPgVoiceSocket(args: {
  userId: string;
  baseUrl?: string;
}): PgVoiceSocketHandle {
  lastUserId = args.userId;
  lastBaseUrl = args.baseUrl;

  if (handle) return handle;

  handle = {
    start: (opts) => {
      ensureSocket().emit("start_session", opts);
    },
    sendText: (text) => {
      ensureSocket().emit("text_input", { text });
    },
    sendAudio: (buf) => {
      const size = buf instanceof ArrayBuffer ? buf.byteLength : (buf as Uint8Array).byteLength;
      if (size > PG_AUDIO_CHUNK_MAX) {
        throw new Error(`audio chunk > ${PG_AUDIO_CHUNK_MAX} bytes`);
      }
      ensureSocket().emit("audio_chunk", buf);
    },
    end: () => {
      // No-op if already torn down; otherwise polite "user_end".
      if (socket) socket.emit("end_session");
    },
    on: (e, cb) => {
      listeners.push({ event: e, cb });
      ensureSocket().on(e, cb);
    },
    off: (e, cb) => {
      const idx = listeners.findIndex((l) => l.event === e && l.cb === cb);
      if (idx >= 0) listeners.splice(idx, 1);
      socket?.off(e, cb);
    },
    connect: () => {
      const s = ensureSocket();
      // Refresh auth with the latest token in case it was set (via setPgVoiceToken)
      // after the socket was built — so the gateway verifies a current session.
      s.auth = { token: lastToken ?? undefined, userId: lastUserId };
      s.connect();
    },
    disconnect: () => {
      socket?.disconnect();
    },
    isConnected: () => !!socket?.connected
  };

  return handle;
}

/**
 * Register the signed-in operator's access token so the gateway can VERIFY the
 * handshake (audit SEC-C2) instead of trusting a client-supplied id. Call this
 * before `connect()`; safe to call repeatedly (updates a live socket's auth too).
 */
export function setPgVoiceToken(token: string | null): void {
  lastToken = token;
  if (socket) socket.auth = { token: token ?? undefined, userId: lastUserId };
}

export function disconnectPgVoiceSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  // Intentionally keep `handle` alive — it's safe to call methods on it
  // afterwards; ensureSocket() will rebuild the underlying client. This
  // avoids a TypeError in React-18 strict-mode dev double-invoke scenarios.
  // Caller can fully discard by nulling their own ref.
  listeners.length = 0;
}
