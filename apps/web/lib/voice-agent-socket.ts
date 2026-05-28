"use client";

import { io, Socket } from "socket.io-client";
import type { VoiceAgentClientEvents, VoiceAgentServerEvents } from "@cribliv/shared-types";

/* ──────────────────────────────────────────────────────────────────────
 * Voice Agent Socket Client
 *
 * Singleton Socket.IO client that connects to the /voice-agent
 * namespace. Typed with shared VoiceAgentClientEvents / ServerEvents.
 * ──────────────────────────────────────────────────────────────────── */

type TypedSocket = Socket<VoiceAgentServerEvents, VoiceAgentClientEvents>;

let socket: TypedSocket | null = null;

export function getVoiceAgentSocket(userId?: string): TypedSocket {
  // Return existing socket (connected or in progress) — never discard it
  if (socket) return socket;

  const baseUrl = (
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.API_BASE_URL ||
    "http://localhost:4000"
  ).replace(/\/v1\/?$/, "");

  console.log("[VoiceAgent] Creating socket to", `${baseUrl}/voice-agent`);

  socket = io(`${baseUrl}/voice-agent`, {
    transports: ["websocket", "polling"],
    auth: {
      userId: userId ?? "anonymous"
    },
    withCredentials: true,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 15000,
    autoConnect: false
  }) as TypedSocket;

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
