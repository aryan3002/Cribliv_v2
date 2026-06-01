"use client";

import { io, Socket } from "socket.io-client";
import type { VoiceAgentClientEvents, VoiceAgentServerEvents } from "@cribliv/shared-types";

/* ──────────────────────────────────────────────────────────────────────
 * Voice Agent (Maya) Socket Client
 *
 * Singleton Socket.IO client that connects to the /voice-agent namespace.
 * Typed with shared VoiceAgentClientEvents / ServerEvents.
 *
 * Lifecycle note (2026-05-30):
 *   Auto re-init pattern. After `disconnectVoiceAgent()` the next
 *   `getVoiceAgentSocket()` builds a fresh socket. This prevents the
 *   "Cannot read properties of null (reading 'connect')" crash that
 *   happens in React-18 strict-mode dev when an effect's cleanup nulls
 *   the singleton while a stale ref-captured handle still points at it.
 *   Same fix was applied to pg-voice-socket.ts in this session.
 * ──────────────────────────────────────────────────────────────────── */

type TypedSocket = Socket<VoiceAgentServerEvents, VoiceAgentClientEvents>;

let socket: TypedSocket | null = null;
let lastUserId = "anonymous";

function buildSocket(): TypedSocket {
  const baseUrl = (
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.API_BASE_URL ||
    "http://localhost:4000"
  ).replace(/\/v1\/?$/, "");

  console.log("[VoiceAgent] Creating socket to", `${baseUrl}/voice-agent`);

  return io(`${baseUrl}/voice-agent`, {
    transports: ["websocket", "polling"],
    auth: { userId: lastUserId },
    withCredentials: true,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 15000,
    autoConnect: false
  }) as TypedSocket;
}

export function getVoiceAgentSocket(userId?: string): TypedSocket {
  if (userId) lastUserId = userId;
  if (!socket) socket = buildSocket();
  return socket;
}

export function disconnectVoiceAgent(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

export function isVoiceAgentConnected(): boolean {
  return socket?.connected ?? false;
}
